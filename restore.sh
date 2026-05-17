#!/bin/bash
set -e

# ─────────────────────────────────────────────
#  S3 백업에서 로컬로 복원
#
#  사용법:
#    ./restore.sh                              # 현재 호스트의 백업 목록
#    ./restore.sh --list-hosts                 # 백업이 존재하는 모든 호스트
#    ./restore.sh <백업명>                      # 현재 폴더로 복원
#    ./restore.sh <백업명> <로컬경로>            # 지정 경로로 복원
#    ./restore.sh --host <호스트> <백업명> [경로] # 다른 호스트의 백업에서 복원
#
#  예시:
#    ./restore.sh work
#    ./restore.sh work ~/restored/work
#    ./restore.sh --host n15190-mac photos ~/Downloads/photos
# ─────────────────────────────────────────────

AWS_REGION="ap-northeast-2"
APP_NAME="my-onair"

# 사전 체크
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text 2>/dev/null) || {
  echo "❌ AWS CLI 인증 실패. 'aws configure'를 먼저 실행하세요."
  exit 1
}

BUCKET="${APP_NAME}-backup-${ACCOUNT_ID}"

# 버킷 존재 확인
if ! aws s3api head-bucket --bucket "${BUCKET}" --region "${AWS_REGION}" 2>/dev/null; then
  echo "❌ 백업 버킷이 존재하지 않습니다: ${BUCKET}"
  echo "  먼저 ./backup.sh 를 실행해 백업을 만드세요."
  exit 1
fi

DEFAULT_HOST=$(hostname -s 2>/dev/null || echo "local")
HOST="${DEFAULT_HOST}"

# ── 옵션 파싱 ──
if [ "$1" = "--list-hosts" ]; then
  echo ""
  echo "========================================="
  echo "  백업이 존재하는 호스트 목록"
  echo "  버킷: ${BUCKET}"
  echo "========================================="
  echo ""
  aws s3 ls "s3://${BUCKET}/" --region "${AWS_REGION}" | awk '/PRE / {print "  - " $2}' | sed 's|/$||'
  echo ""
  exit 0
fi

if [ "$1" = "--host" ]; then
  if [ -z "$2" ]; then
    echo "❌ --host 다음에 호스트명이 필요합니다."
    exit 1
  fi
  HOST="$2"
  shift 2
fi

# ── 백업 목록 모드 ──
if [ "$#" -eq 0 ]; then
  echo ""
  echo "========================================="
  echo "  '${HOST}'의 백업 목록"
  echo "  버킷: ${BUCKET}"
  echo "========================================="
  echo ""

  LISTING=$(aws s3 ls "s3://${BUCKET}/${HOST}/" --region "${AWS_REGION}" 2>/dev/null || true)

  if [ -z "${LISTING}" ]; then
    echo "  (백업 없음)"
    echo ""
    echo "다른 호스트의 백업을 보려면:  ./restore.sh --list-hosts"
    exit 0
  fi

  echo "  [폴더]"
  echo "${LISTING}" | awk '/PRE / {print "    " $2}' | sed 's|/$||'
  echo ""
  echo "  [파일]"
  echo "${LISTING}" | awk '!/PRE / && NF>=4 {size=$3; name=$4; for(i=5;i<=NF;i++) name=name" "$i; printf "    %-50s %s\n", name, size}'
  echo ""
  echo "복원: ./restore.sh <이름> [로컬경로]"
  exit 0
fi

# ── 복원 모드 ──
NAME="$1"
DEST="${2:-./${NAME}}"

# ~ 확장
DEST="${DEST/#\~/${HOME}}"

S3_KEY="${HOST}/${NAME}"
S3_URI="s3://${BUCKET}/${S3_KEY}"

echo ""
echo "========================================="
echo "  복원: ${HOST}/${NAME}"
echo "========================================="
echo ""

# 폴더인지 파일인지 자동 판별
# 1) 정확히 일치하는 객체(파일)인지 확인
IS_FILE="no"
if aws s3api head-object --bucket "${BUCKET}" --key "${S3_KEY}" --region "${AWS_REGION}" > /dev/null 2>&1; then
  IS_FILE="yes"
fi

# 2) 폴더(접두사)로 존재하는지 확인
HAS_PREFIX="no"
PREFIX_CHECK=$(aws s3 ls "${S3_URI}/" --region "${AWS_REGION}" 2>/dev/null || true)
if [ -n "${PREFIX_CHECK}" ]; then
  HAS_PREFIX="yes"
fi

if [ "${IS_FILE}" = "no" ] && [ "${HAS_PREFIX}" = "no" ]; then
  echo "❌ S3에서 찾을 수 없습니다: ${S3_URI}"
  echo ""
  echo "사용 가능한 백업 보기: ./restore.sh"
  exit 1
fi

# 충돌 방지: 같은 이름의 파일과 폴더가 둘 다 있는 경우 사용자에게 알림
if [ "${IS_FILE}" = "yes" ] && [ "${HAS_PREFIX}" = "yes" ]; then
  echo "⚠ S3에 같은 이름의 파일과 폴더가 모두 존재합니다."
  echo "  폴더 쪽을 복원합니다. 파일을 받으려면:"
  echo "    aws s3 cp ${S3_URI} ${DEST} --region ${AWS_REGION}"
  echo ""
  IS_FILE="no"
fi

# ── 다운로드 ──
echo "▶ 원본: ${S3_URI}"
echo "▶ 대상: ${DEST}"
echo ""

if [ "${IS_FILE}" = "yes" ]; then
  # 파일 1개 복원
  DEST_DIR=$(dirname "${DEST}")
  if [ ! -d "${DEST_DIR}" ]; then
    mkdir -p "${DEST_DIR}" || {
      echo "❌ 대상 디렉토리 생성 실패: ${DEST_DIR}"
      exit 1
    }
  fi

  if aws s3 cp "${S3_URI}" "${DEST}" --region "${AWS_REGION}"; then
    echo ""
    echo "========================================="
    echo "  ✓ 파일 복원 완료!"
    echo "  → ${DEST}"
    echo "========================================="
  else
    echo "❌ 다운로드 실패"
    exit 1
  fi
else
  # 폴더 복원 (sync)
  if [ -e "${DEST}" ] && [ ! -d "${DEST}" ]; then
    echo "❌ 대상 경로가 파일로 존재합니다: ${DEST}"
    exit 1
  fi

  mkdir -p "${DEST}" || {
    echo "❌ 대상 디렉토리 생성 실패: ${DEST}"
    exit 1
  }

  if aws s3 sync "${S3_URI}" "${DEST}" --region "${AWS_REGION}"; then
    echo ""
    echo "========================================="
    echo "  ✓ 폴더 복원 완료!"
    echo "  → ${DEST}"
    echo "========================================="
  else
    echo "❌ 동기화 실패"
    exit 1
  fi
fi
