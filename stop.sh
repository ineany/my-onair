#!/bin/bash
set -e

# ─────────────────────────────────────────────
#  my-onair 비용 정지 스크립트
#  ECS 서비스 desired-count=0 → Fargate/퍼블릭 IP 비용 중단
#  인프라(ECR, SG, IAM, 클러스터, 로그그룹)는 유지
#  → 재시작은 ./start.sh
# ─────────────────────────────────────────────

AWS_REGION="ap-northeast-2"
APP_NAME="my-onair"

echo ""
echo "========================================="
echo "  비용 정지: ${APP_NAME}"
echo "========================================="
echo ""

# 사전 체크
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text 2>/dev/null) || {
  echo "❌ AWS CLI 인증 실패. 'aws configure'를 먼저 실행하세요."
  exit 1
}
echo "✓ AWS 계정: ${ACCOUNT_ID}"

# ── 1. 클러스터 존재 확인 ──
CLUSTER_STATUS=$(aws ecs describe-clusters \
  --clusters "${APP_NAME}" \
  --region "${AWS_REGION}" \
  --query "clusters[0].status" --output text 2>/dev/null || echo "NONE")

if [ "${CLUSTER_STATUS}" != "ACTIVE" ]; then
  echo "  - 클러스터가 존재하지 않습니다. 이미 비용이 발생하지 않는 상태입니다."
  exit 0
fi

# ── 2. 서비스 존재 확인 ──
SERVICE_STATUS=$(aws ecs describe-services \
  --cluster "${APP_NAME}" --services "${APP_NAME}" \
  --region "${AWS_REGION}" \
  --query "services[0].status" --output text 2>/dev/null || echo "NONE")

if [ "${SERVICE_STATUS}" != "ACTIVE" ]; then
  echo "  - ECS 서비스가 활성 상태가 아닙니다. 추가 조치 불필요."
  exit 0
fi

# ── 3. desired-count=0 ──
echo "▶ [1/2] ECS 서비스 desired-count → 0"
aws ecs update-service \
  --cluster "${APP_NAME}" --service "${APP_NAME}" \
  --desired-count 0 \
  --region "${AWS_REGION}" > /dev/null || {
  echo "❌ desired-count 변경 실패"
  exit 1
}
echo "  ✓ 적용 완료"

# ── 4. 태스크 종료 대기 ──
echo ""
echo "▶ [2/2] 실행 중인 태스크 종료 대기 중... (최대 3분)"

for i in $(seq 1 36); do
  RUNNING_COUNT=$(aws ecs describe-services \
    --cluster "${APP_NAME}" --services "${APP_NAME}" \
    --region "${AWS_REGION}" \
    --query "services[0].runningCount" --output text 2>/dev/null || echo "0")

  if [ "${RUNNING_COUNT}" = "0" ]; then
    echo "  ✓ 모든 태스크 종료 완료"
    break
  fi
  echo "  대기 중... runningCount=${RUNNING_COUNT} (${i}/36)"
  sleep 5
done

if [ "${RUNNING_COUNT}" != "0" ]; then
  echo "  ⚠ 일부 태스크가 아직 종료되지 않았습니다. AWS 콘솔에서 확인하세요."
fi

echo ""
echo "========================================="
echo "  ✓ 비용 정지 완료!"
echo ""
echo "  현재 유지 중인 리소스 (비용 거의 없음):"
echo "    - ECR 이미지 (보관료 월 ~\$0.01)"
echo "    - ECS 클러스터/서비스 (정의만)"
echo "    - 보안 그룹/IAM Role/로그 그룹"
echo ""
echo "  재시작: ./start.sh"
echo "========================================="
