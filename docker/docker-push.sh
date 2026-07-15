#!/bin/bash

# GHCR Push Script for Classroom
# Builds and pushes the API, Dashboard, and Jobs worker images to GHCR.
# Uses buildx for native multi-arch (linux/amd64 + linux/arm64).

set -e  # Exit on error

# Configuration
IMAGE_NAMESPACE="${IMAGE_NAMESPACE:-ghcr.io/tedydev-web}"
VERSION="${VERSION:?set VERSION to the tag to publish, e.g. VERSION=1.4.2 — this script never pushes :latest (CI owns latest from main)}"
PUBLIC_IS_SELFHOSTED="${PUBLIC_IS_SELFHOSTED:-false}"
PUBLIC_IS_SELF_OWNED="${PUBLIC_IS_SELF_OWNED:-true}"
PLATFORMS="${PLATFORMS:-linux/amd64,linux/arm64}"

# This manual/local helper pushes ONLY the explicit ${VERSION} tag. `latest` is published
# exclusively by CI from `main` (see .github/workflows/docker-publish.yml) — to move `latest`,
# merge to main or re-run that workflow, never this script.

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}================================${NC}"
echo -e "${BLUE}Classroom GHCR Publisher${NC}"
echo -e "${BLUE}================================${NC}"
echo ""
echo "Platforms: ${PLATFORMS}"
echo ""

# Ensure a buildx builder exists (multi-arch requires buildx + QEMU).
if ! docker buildx inspect cio-builder >/dev/null 2>&1; then
  echo -e "${GREEN}Creating buildx builder 'cio-builder'...${NC}"
  docker buildx create --name cio-builder --use >/dev/null
else
  docker buildx use cio-builder
fi

# Build and push API (multi-arch images must be pushed in one buildx step).
echo -e "${GREEN}Building + pushing API image...${NC}"
docker buildx build \
    --platform "${PLATFORMS}" \
    -f docker/Dockerfile.api \
    -t ${IMAGE_NAMESPACE}/classroom-api:${VERSION} \
    --push \
    .
echo -e "${GREEN}✓ API image published successfully!${NC}"
echo ""

# Build and push Dashboard
echo -e "${GREEN}Building + pushing Dashboard image...${NC}"
echo "Dashboard build arg PUBLIC_IS_SELFHOSTED=${PUBLIC_IS_SELFHOSTED}"
echo "Dashboard build arg PUBLIC_IS_SELF_OWNED=${PUBLIC_IS_SELF_OWNED}"
docker buildx build \
    --platform "${PLATFORMS}" \
    -f docker/Dockerfile.dashboard \
    --build-arg PUBLIC_IS_SELFHOSTED=${PUBLIC_IS_SELFHOSTED} \
    --build-arg PUBLIC_IS_SELF_OWNED=${PUBLIC_IS_SELF_OWNED} \
    -t ${IMAGE_NAMESPACE}/classroom-dashboard:${VERSION} \
    --push \
    .
echo -e "${GREEN}✓ Dashboard image published successfully!${NC}"
echo ""

# Build and push Jobs worker (required for video/transcription/AI-generation/email).
echo -e "${GREEN}Building + pushing Jobs worker image...${NC}"
docker buildx build \
    --platform "${PLATFORMS}" \
    -f docker/Dockerfile.jobs \
    -t ${IMAGE_NAMESPACE}/classroom-jobs:${VERSION} \
    --push \
    .
echo -e "${GREEN}✓ Jobs image published successfully!${NC}"

# Summary
echo -e "${BLUE}================================${NC}"
echo -e "${GREEN}All images published successfully!${NC}"
echo -e "${BLUE}================================${NC}"
echo ""
echo "API Image:       ${IMAGE_NAMESPACE}/classroom-api:${VERSION}"
echo "Dashboard Image: ${IMAGE_NAMESPACE}/classroom-dashboard:${VERSION}"
echo "Jobs Image:      ${IMAGE_NAMESPACE}/classroom-jobs:${VERSION}"
echo ""
echo "To pull these images:"
echo "  docker pull ${IMAGE_NAMESPACE}/classroom-api:${VERSION}"
echo "  docker pull ${IMAGE_NAMESPACE}/classroom-dashboard:${VERSION}"
echo "  docker pull ${IMAGE_NAMESPACE}/classroom-jobs:${VERSION}"
