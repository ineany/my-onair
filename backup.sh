#!/bin/bash
set -e

# ─────────────────────────────────────────────
#  로컬 파일/폴더를 S3로 백업
#
#  사용법:
#    ./backup.sh <경로1> [경로2] [경로3] ...
#
#  예시:
#    ./backup.sh ~/Documents/work
#    ./backup.sh ~/photos ~/projects/foo ~/notes.txt
#
#  특징:
#    - 버킷 자동 생성 (my-onair-backup-{계정ID})
#    - Standard-IA 스토리지 클래스 (저비용 백업용)
#    - 퍼블릭 액세스 완전 차단
#    - 버전 관리 활성화 (실수로 덮어써도 복구 가능)
#    - 폴더는 s3 sync (변경분만 업로드)
#    - 파일은 s3 cp
# ─────────────────────────────────────────────

AWS_REGION="ap-northeast-2"
APP_NAME="my-onair"
STORAGE_CLASS="STANDARD_IA"

# 인자 체크
if [ "$#" -lt 1 ]; then
  echo "❌ 사용법: $0 <경로1> [경로2] ..."
  echo ""
  echo "예시:"
  echo "  $0 ~/Documents/work"
  echo "  $0 ~/photos ~/projects/foo ~/notes.txt"
  exit 1
fi

# 사전 체크
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text 2>/dev/null) || {
  echo "❌ AWS CLI 인증 실패. 'aws configure'를 먼저 실행하세요."
  exit 1
}

BUCKET="${APP_NAME}-backup-${ACCOUNT_ID}"

echo ""
echo "========================================="
echo "  S3 백업: ${BUCKET}"
echo "  리전:    ${AWS_REGION}"
echo "  클래스:  ${STORAGE_CLASS}"
echo "========================================="
echo ""

# ── 1. 버킷 존재 확인 / 생성 ──
echo "▶ [1/3] 버킷 상태 확인..."

if aws s3api head-bucket --bucket "${BUCKET}" --region "${AWS_REGION}" 2>/dev/null; then
  echo "  - 버킷 이미 존재: ${BUCKET}"
else
  echo "  + 버킷 신규 생성: ${BUCKET}"

  # us-east-1만 LocationConstraint 생략
  if [ "${AWS_REGION}" = "us-east-1" ]; then
    aws s3api create-bucket \
      --bucket "${BUCKET}" \
      --region "${AWS_REGION}" > /dev/null || {
      echo "❌ 버킷 생성 실패"
      exit 1
    }
  else
    aws s3api create-bucket \
      --bucket "${BUCKET}" \
      --region "${AWS_REGION}" \
      --create-bucket-configuration "LocationConstraint=${AWS_REGION}" > /dev/null || {
      echo "❌ 버킷 생성 실패"
      exit 1
    }
  fi

  # 퍼블릭 액세스 완전 차단
  aws s3api put-public-access-block \
    --bucket "${BUCKET}" \
    --public-access-block-configuration "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true" \
    --region "${AWS_REGION}" > /dev/null || {
    echo "⚠ 퍼블릭 액세스 차단 설정 실패 (계속 진행)"
  }

  # 버전 관리 활성화 (실수 복구용)
  aws s3api put-bucket-versioning \
    --bucket "${BUCKET}" \
    --versioning-configuration "Status=Enabled" \
    --region "${AWS_REGION}" > /dev/null || {
    echo "⚠ 버전 관리 활성화 실패 (계속 진행)"
  }

  # 서버 측 암호화 (AES256)
  aws s3api put-bucket-encryption \
    --bucket "${BUCKET}" \
    --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}' \
    --region "${AWS_REGION}" > /dev/null || {
    echo "⚠ 서버 측 암호화 설정 실패 (계속 진행)"
  }

  echo "  ✓ 버킷 생성 완료 (퍼블릭 차단 / 버전 관리 / 암호화 적용)"
fi

# ── 2. 경로 검증 ──
echo ""
echo "▶ [2/3] 경로 검증..."
VALID_PATHS=()
for SRC in "$@"; do
  # ~ 확장
  SRC="${SRC/#\~/${HOME}}"
  # 절대 경로 변환
  if [ ! -e "${SRC}" ]; then
    echo "  ⚠ 경로 없음 (스킵): ${SRC}"
    continue
  fi
  ABS_PATH=$(cd "$(dirname "${SRC}")" 2>/dev/null && pwd)/$(basename "${SRC}")
  VALID_PATHS+=("${ABS_PATH}")
  echo "  ✓ ${ABS_PATH}"
done

if [ "${#VALID_PATHS[@]}" -eq 0 ]; then
  echo "❌ 유효한 경로가 하나도 없습니다."
  exit 1
fi

# ── 3. 업로드 ──
echo ""
echo "▶ [3/3] 업로드 시작..."
HOSTNAME_PREFIX=$(hostname -s 2>/dev/null || echo "local")

SUCCESS=0
FAILED=0
for SRC in "${VALID_PATHS[@]}"; do
  BASE=$(basename "${SRC}")
  S3_DEST="s3://${BUCKET}/${HOSTNAME_PREFIX}/${BASE}"

  echo ""
  echo "  ─── ${SRC}"
  echo "      → ${S3_DEST}"

  if [ -d "${SRC}" ]; then
    # 폴더: sync (변경분만, 빠름)
    if aws s3 sync "${SRC}" "${S3_DEST}" \
      --storage-class "${STORAGE_CLASS}" \
      --region "${AWS_REGION}"; then
      SUCCESS=$((SUCCESS + 1))
      echo "      ✓ 동기화 완료"
    else
      FAILED=$((FAILED + 1))
      echo "      ❌ 동기화 실패"
    fi
  elif [ -f "${SRC}" ]; then
    # 파일: cp
    if aws s3 cp "${SRC}" "${S3_DEST}" \
      --storage-class "${STORAGE_CLASS}" \
      --region "${AWS_REGION}"; then
      SUCCESS=$((SUCCESS + 1))
      echo "      ✓ 업로드 완료"
    else
      FAILED=$((FAILED + 1))
      echo "      ❌ 업로드 실패"
    fi
  else
    echo "      ⚠ 파일도 폴더도 아님 (스킵)"
    FAILED=$((FAILED + 1))
  fi
done

echo ""
echo "========================================="
echo "  백업 결과: 성공 ${SUCCESS} / 실패 ${FAILED}"
echo ""
echo "  S3 경로: s3://${BUCKET}/${HOSTNAME_PREFIX}/"
echo "  확인:    aws s3 ls s3://${BUCKET}/${HOSTNAME_PREFIX}/ --region ${AWS_REGION}"
echo "========================================="

if [ "${FAILED}" -gt 0 ]; then
  exit 1
fi
