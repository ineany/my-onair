#!/bin/bash
set -e

# ─────────────────────────────────────────────
#  my-onair AWS 인프라 초기 구축 (최초 1회)
#
#  생성되는 리소스:
#    - ECR 리포지토리
#    - ECS 클러스터
#    - CloudWatch 로그 그룹
#    - Task Execution Role
#    - 보안 그룹 (포트 80/443)
#    - Task Definition
# ─────────────────────────────────────────────

AWS_REGION="ap-northeast-2"
APP_NAME="my-onair"

echo ""
echo "========================================="
echo "  AWS 인프라 초기 구축: ${APP_NAME}"
echo "  리전: ${AWS_REGION}"
echo "========================================="
echo ""

# 사전 체크
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text 2>/dev/null) || {
  echo "❌ AWS CLI 인증 실패."
  echo "  1. brew install awscli"
  echo "  2. aws configure"
  exit 1
}
echo "✓ AWS 계정: ${ACCOUNT_ID}"

docker info > /dev/null 2>&1 || {
  echo "❌ Docker Desktop을 실행하세요."
  exit 1
}
echo "✓ Docker 실행 중"
echo ""

ECR_URI="${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${APP_NAME}"
EXEC_ROLE_NAME="ecsTaskExecutionRole"

# ── 1. ECR ──
echo "▶ [1/6] ECR 리포지토리..."
aws ecr create-repository \
  --repository-name "${APP_NAME}" \
  --region "${AWS_REGION}" > /dev/null 2>&1 && echo "  ✓ 생성 완료" || echo "  - 이미 존재"

# ── 2. ECS 클러스터 ──
echo "▶ [2/6] ECS 클러스터..."
aws ecs create-cluster \
  --cluster-name "${APP_NAME}" \
  --region "${AWS_REGION}" > /dev/null 2>&1 && echo "  ✓ 생성 완료" || echo "  - 이미 존재"

# ── 3. 로그 그룹 ──
echo "▶ [3/6] CloudWatch 로그 그룹..."
aws logs create-log-group \
  --log-group-name "/ecs/${APP_NAME}" \
  --region "${AWS_REGION}" 2>/dev/null && echo "  ✓ 생성 완료" || echo "  - 이미 존재"

# ── 4. IAM 역할 ──
echo "▶ [4/6] IAM 역할..."
aws iam create-role \
  --role-name "${EXEC_ROLE_NAME}" \
  --assume-role-policy-document '{
    "Version":"2012-10-17",
    "Statement":[{
      "Effect":"Allow",
      "Principal":{"Service":"ecs-tasks.amazonaws.com"},
      "Action":"sts:AssumeRole"
    }]
  }' > /dev/null 2>&1 && echo "  ✓ 역할 생성 완료" || echo "  - 역할 이미 존재"

aws iam attach-role-policy \
  --role-name "${EXEC_ROLE_NAME}" \
  --policy-arn "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy" 2>/dev/null || true

aws iam create-service-linked-role \
  --aws-service-name ecs.amazonaws.com 2>/dev/null || true

# ── 5. 네트워크 ──
echo "▶ [5/6] 네트워크 (기본 VPC)..."
VPC_ID=$(aws ec2 describe-vpcs --filters "Name=isDefault,Values=true" \
  --region "${AWS_REGION}" --query "Vpcs[0].VpcId" --output text)
SUBNET_ID=$(aws ec2 describe-subnets --filters "Name=vpc-id,Values=${VPC_ID}" \
  --region "${AWS_REGION}" --query "Subnets[0].SubnetId" --output text)

SG_NAME="${APP_NAME}-sg"
SG_ID=$(aws ec2 describe-security-groups \
  --filters "Name=group-name,Values=${SG_NAME}" "Name=vpc-id,Values=${VPC_ID}" \
  --region "${AWS_REGION}" --query "SecurityGroups[0].GroupId" --output text 2>/dev/null)

if [ -z "${SG_ID}" ] || [ "${SG_ID}" = "None" ]; then
  SG_ID=$(aws ec2 create-security-group \
    --group-name "${SG_NAME}" --description "SG for ${APP_NAME}" \
    --vpc-id "${VPC_ID}" --region "${AWS_REGION}" \
    --query "GroupId" --output text)
  aws ec2 authorize-security-group-ingress \
    --group-id "${SG_ID}" --protocol tcp --port 80 \
    --cidr 0.0.0.0/0 --region "${AWS_REGION}" > /dev/null
  aws ec2 authorize-security-group-ingress \
    --group-id "${SG_ID}" --protocol tcp --port 443 \
    --cidr 0.0.0.0/0 --region "${AWS_REGION}" > /dev/null
  echo "  ✓ 보안 그룹 생성: ${SG_ID}"
else
  echo "  - 보안 그룹 이미 존재: ${SG_ID}"
fi

echo "  VPC: ${VPC_ID} / 서브넷: ${SUBNET_ID}"

# ── 6. Task Definition ──
echo "▶ [6/6] Task Definition..."
EXEC_ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/${EXEC_ROLE_NAME}"

TD_ARN=$(aws ecs register-task-definition \
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
  --region "${AWS_REGION}" \
  --query "taskDefinition.taskDefinitionArn" --output text)
echo "  ✓ ${TD_ARN}"

echo ""
echo "========================================="
echo "  ✓ 인프라 구축 완료!"
echo ""
echo "  다음 단계:"
echo "    ./deploy.sh    ← Docker 빌드 & 배포"
echo "========================================="
