#!/bin/bash
set -e

# ─────────────────────────────────────────────
#  my-onair 배포 스크립트
#  Docker 빌드 → ECR 푸시 → ECS 재배포
# ─────────────────────────────────────────────

AWS_REGION="ap-northeast-2"
APP_NAME="my-onair"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text 2>/dev/null) || {
  echo "❌ AWS CLI 인증 실패. 'aws configure'를 먼저 실행하세요."; exit 1
}
ECR_URI="${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${APP_NAME}"

docker info > /dev/null 2>&1 || {
  echo "❌ Docker가 실행되고 있지 않습니다."; exit 1
}

echo ""
echo "========================================="
echo "  배포: ${APP_NAME} → ${AWS_REGION}"
echo "  계정: ${ACCOUNT_ID}"
echo "========================================="

# ── 0. 인프라 부트스트랩 (없으면 자동 생성) ──
echo ""
echo "▶ [0/4] 인프라 상태 확인..."

CLUSTER_STATUS=$(aws ecs describe-clusters \
  --clusters "${APP_NAME}" \
  --region "${AWS_REGION}" \
  --query "clusters[0].status" --output text 2>/dev/null || echo "NONE")

ECR_EXISTS=$(aws ecr describe-repositories \
  --repository-names "${APP_NAME}" \
  --region "${AWS_REGION}" \
  --query "repositories[0].repositoryName" --output text 2>/dev/null || echo "NONE")

ROLE_EXISTS=$(aws iam get-role \
  --role-name "ecsTaskExecutionRole" \
  --query "Role.RoleName" --output text 2>/dev/null || echo "NONE")

if [ "${CLUSTER_STATUS}" != "ACTIVE" ] || [ "${ECR_EXISTS}" = "NONE" ] || [ "${ROLE_EXISTS}" = "NONE" ]; then
  echo "  ⚠ 인프라가 누락되어 있습니다. setup-aws.sh 를 먼저 실행합니다."
  echo "    - 클러스터: ${CLUSTER_STATUS}"
  echo "    - ECR:      ${ECR_EXISTS}"
  echo "    - IAM Role: ${ROLE_EXISTS}"
  echo ""
  if [ ! -x "${SCRIPT_DIR}/setup-aws.sh" ]; then
    echo "❌ ${SCRIPT_DIR}/setup-aws.sh 를 실행할 수 없습니다 (파일 없음/실행권한 없음)."
    exit 1
  fi
  "${SCRIPT_DIR}/setup-aws.sh" || {
    echo "❌ 인프라 부트스트랩 실패. 위 오류를 확인하세요."
    exit 1
  }
  echo ""
  echo "  ✓ 인프라 부트스트랩 완료. 배포를 계속 진행합니다."
else
  echo "  ✓ 인프라 정상 (클러스터/ECR/IAM Role 확인됨)"
fi

# ── 1. ECR 로그인 ──
echo ""
echo "▶ [1/4] ECR 로그인..."
aws ecr get-login-password --region "${AWS_REGION}" | \
  docker login --username AWS --password-stdin \
  "${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com" 2>/dev/null
echo "  ✓ 완료"

# ── 2. Docker 빌드 ──
echo ""
echo "▶ [2/4] Docker 이미지 빌드..."
docker build --platform linux/amd64 -t "${APP_NAME}" .

# ── 3. ECR 푸시 ──
echo ""
echo "▶ [3/4] ECR 푸시..."
docker tag "${APP_NAME}:latest" "${ECR_URI}:latest"
docker push "${ECR_URI}:latest"

# ── 4. ECS 재배포 ──
echo ""
echo "▶ [4/4] ECS 서비스 재배포..."

EXEC_ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/ecsTaskExecutionRole"

aws ecs register-task-definition \
  --family "${APP_NAME}" \
  --network-mode awsvpc \
  --requires-compatibilities FARGATE \
  --cpu "512" --memory "1024" \
  --execution-role-arn "${EXEC_ROLE_ARN}" \
  --container-definitions "[{
    \"name\":\"${APP_NAME}\",
    \"image\":\"${ECR_URI}:latest\",
    \"portMappings\":[
      {\"containerPort\":80,\"protocol\":\"tcp\"},
      {\"containerPort\":443,\"protocol\":\"tcp\"}
    ],
    \"logConfiguration\":{
      \"logDriver\":\"awslogs\",
      \"options\":{
        \"awslogs-group\":\"/ecs/${APP_NAME}\",
        \"awslogs-region\":\"${AWS_REGION}\",
        \"awslogs-stream-prefix\":\"ecs\"
      }
    },
    \"essential\":true
  }]" \
  --region "${AWS_REGION}" > /dev/null

EXISTING=$(aws ecs describe-services \
  --cluster "${APP_NAME}" --services "${APP_NAME}" \
  --region "${AWS_REGION}" \
  --query "services[?status=='ACTIVE'].serviceName" \
  --output text 2>/dev/null)

if [ -z "${EXISTING}" ] || [ "${EXISTING}" = "None" ]; then
  VPC_ID=$(aws ec2 describe-vpcs --filters "Name=isDefault,Values=true" \
    --region "${AWS_REGION}" --query "Vpcs[0].VpcId" --output text)
  SUBNET_ID=$(aws ec2 describe-subnets --filters "Name=vpc-id,Values=${VPC_ID}" \
    --region "${AWS_REGION}" --query "Subnets[0].SubnetId" --output text)
  SG_ID=$(aws ec2 describe-security-groups \
    --filters "Name=group-name,Values=${APP_NAME}-sg" "Name=vpc-id,Values=${VPC_ID}" \
    --region "${AWS_REGION}" --query "SecurityGroups[0].GroupId" --output text)

  aws ecs create-service \
    --cluster "${APP_NAME}" --service-name "${APP_NAME}" \
    --task-definition "${APP_NAME}" --desired-count 1 \
    --launch-type FARGATE \
    --network-configuration "awsvpcConfiguration={subnets=[${SUBNET_ID}],securityGroups=[${SG_ID}],assignPublicIp=ENABLED}" \
    --region "${AWS_REGION}" > /dev/null
else
  aws ecs update-service \
    --cluster "${APP_NAME}" --service "${APP_NAME}" \
    --task-definition "${APP_NAME}" --force-new-deployment \
    --region "${AWS_REGION}" > /dev/null
fi

# ── 배포 안정화 대기 → 최신 태스크 IP 확인 ──
echo ""
echo "▶ 서비스 안정화 대기 중... (최대 5분)"
aws ecs wait services-stable \
  --cluster "${APP_NAME}" --services "${APP_NAME}" \
  --region "${AWS_REGION}" 2>/dev/null || true

echo "▶ 최신 태스크 IP 확인 중..."
for i in $(seq 1 20); do
  # 가장 최근에 시작된 RUNNING 태스크 가져오기
  TASK_ARN=$(aws ecs list-tasks --cluster "${APP_NAME}" --service-name "${APP_NAME}" \
    --desired-status RUNNING --region "${AWS_REGION}" \
    --query "taskArns[-1]" --output text 2>/dev/null)

  if [ -n "${TASK_ARN}" ] && [ "${TASK_ARN}" != "None" ]; then
    # 태스크의 마지막 상태가 RUNNING인지 확인
    TASK_STATUS=$(aws ecs describe-tasks --cluster "${APP_NAME}" --tasks "${TASK_ARN}" \
      --region "${AWS_REGION}" \
      --query "tasks[0].lastStatus" --output text 2>/dev/null)

    if [ "${TASK_STATUS}" = "RUNNING" ]; then
      ENI_ID=$(aws ecs describe-tasks --cluster "${APP_NAME}" --tasks "${TASK_ARN}" \
        --region "${AWS_REGION}" \
        --query "tasks[0].attachments[0].details[?name=='networkInterfaceId'].value" \
        --output text 2>/dev/null)

      if [ -n "${ENI_ID}" ] && [ "${ENI_ID}" != "None" ]; then
        PUBLIC_IP=$(aws ec2 describe-network-interfaces --network-interface-ids "${ENI_ID}" \
          --region "${AWS_REGION}" \
          --query "NetworkInterfaces[0].Association.PublicIp" --output text 2>/dev/null)

        if [ -n "${PUBLIC_IP}" ] && [ "${PUBLIC_IP}" != "None" ]; then
          echo ""
          echo "========================================="
          echo "  ✓ 배포 완료!"
          echo ""
          echo "  IP:    http://${PUBLIC_IP}"
          echo "  HTTPS: https://myonair.freeddns.org"
          echo "  (DNS 반영 + SSL 발급까지 약 3~5분 소요)"
          echo "========================================="
          exit 0
        fi
      fi
    fi
  fi
  echo "  대기 중... (${i}/20)"
  sleep 5
done

echo ""
echo "⚠ 태스크 시작 중. 잠시 후 접속하세요:"
echo "  https://myonair.freeddns.org"
