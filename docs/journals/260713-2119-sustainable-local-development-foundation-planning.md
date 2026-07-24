---
title: "Lập kế hoạch nền tảng phát triển local bền vững"
date: "2026-07-13T22:43:00+07:00"
status: planning-complete
severity: high
component: local-development-foundation
repository: Tedydev-web/classroomio
tags: [brainstorm, deep-tdd, local-development, docker, agpl]
---

# Lập kế hoạch nền tảng phát triển local bền vững

## Context

Phiên này bắt đầu từ yêu cầu tưởng như chỉ là “setup local”, nhưng bằng chứng cho thấy fork chưa có contract phát triển tái tạo được: máy đang dùng Node 24 thay vì `20.19.3`, production Compose không parse khi thiếu `BETTER_AUTH_SECRET`, API và dashboard có thể chạy lệch `PUBLIC_IS_SELFHOSTED`, SMTP hiện tại không dùng được Mailpit mặc định, còn quality gate bị chia vụn. Nguyên nhân gốc là chúng ta đã coi setup như một danh sách lệnh thủ công thay vì một phần của platform cần test, version và bảo vệ dữ liệu.

## What happened

Chúng ta chọn **host-dev + Docker infrastructure**: Node/pnpm và app processes chạy trên host để giữ hot reload; PostgreSQL, Redis, MinIO và Mailpit chạy bằng Docker. Setup thủ công bị loại vì không giải quyết drift; Docker-only/devcontainer bị loại vì I/O và debug trên Windows tệ hơn, đồng thời lệch upstream nhiều hơn.

Kế hoạch **Deep + TDD** được chia thành 6 phase tuần tự: diagnostics, infrastructure bootstrap, email, runtime/E2E, monorepo quality/CI và AGPL brand readiness. Red-team chấp nhận đủ 8 finding, gồm tách bearer email khỏi Playwright trace, thêm `setup:env` cho CI không Docker, không ghi đè endpoint hợp lệ, đổi API sang `vitest run`, đồng bộ Storybook và Lucide, dùng SPDX `AGPL-3.0-only`, bỏ shell glob trong script tests và dọn object MinIO trong `finally`.

Validation kiểm tra 96 claims: 92 đã xác minh, 0 thất bại; 4 quyết định vận hành được chốt là E2E dùng Compose project/ports/volumes riêng, chạy static/unit và E2E trên mọi PR cùng push `main`, pin chính xác Docker image, và chỉ dùng credential dev cố định trên loopback. `ck plan validate --strict` kết thúc với 0 error, 0 warning.

## Reflection

Thú thật, phần khó chịu nhất là “chỉ setup” đã lộ ra test runner chết, mode contract mâu thuẫn và metadata license sai. Chọn đường tắt sẽ giúp một máy chạy hôm nay nhưng bắt người kế tiếp trả nợ lúc 2 giờ sáng. Điều đáng nhẹ nhõm là plan giờ đã khóa được ranh giới và không còn mâu thuẫn chưa giải quyết.

## Decisions

- Giữ cloud-like làm mode local mặc định; self-hosted chỉ là smoke mode phụ.
- Triển khai theo 6 phase, test đỏ trước rồi mới sửa; không làm xanh bằng skip hoặc nới gate.
- Giữ `@cio/*`, hoãn full rebrand; root license phải là `AGPL-3.0-only`.
- Chưa triển khai code, config hay migration trong phiên này; chỉ lập và kiểm chứng kế hoạch.

## Next

- **Chủ fork** phê duyệt điểm bắt đầu trước khi có thay đổi code.
- **Người triển khai** thực hiện Phase 1→6 theo thứ tự, lưu bằng chứng red/green và dừng khi regression gate chưa xanh.
- **Trước public deployment**, hoàn tất source/legal notices và review nghĩa vụ AGPL; branding/domain/logo tiếp tục là scope riêng.
