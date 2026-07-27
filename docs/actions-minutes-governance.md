# Governance hành động Actions để giảm chi phí minute cho Tedydev-web

## Mục tiêu

- Giảm tiêu thụ `Actions minutes` thực tế.
- Giữ pipeline tự động đủ để triển khai ổn định, nhưng không chạy thừa.
- Tập trung xử lý bằng hạ tầng của bạn (Coolify/runner nội bộ), không phụ thuộc máy chủ random.

## Kết luận nhanh từ kiểm tra hiện tại

Quan sát hiện trạng `.github/workflows`, phần lớn công việc đã chuyển sang:

- `runs-on: self-hosted` cho tất cả workflow.
- `concurrency` để tránh đụng hàng song song.
- `permissions` tối giản hơn.

Các workflow này giúp giảm lệ thuộc `GitHub-hosted`, nhưng cảnh báo minute vẫn có thể còn tồn tại do:

- lịch sử chạy trước khi chuyển sang self-hosted,
- workflow vẫn có các đường chạy song song nhau cho cùng phạm vi,
- minute của toàn org/repo không chỉ nằm ở các workflow deploy.

## Hành động đã thực hiện ngay

- Tắt trigger `push` cho `package-build-check.yml`; workflow này vẫn chạy cho `pull_request` để bắt compile cơ bản với PR, tránh chạy thêm một lượt build trùng khi push lên `main`.

## Vì sao không cần Jenkins ngay

- Jenkins cần: master node, quản lý executor, agent lifecycle, cập nhật plugin, dashboard, backup, access control.
- Với stack hiện có, Actions + self-hosted runner tích hợp tốt hơn vì:
  - cùng source control,
  - không phải chuyển đổi DSL/agent cấu hình,
  - webhook deploy có thể gọi trực tiếp Coolify API.
- Jenkins chỉ nên dùng khi bạn cần orchestration đa dự án phức tạp hơn, nhiều SCM/trunk không phải GitHub.

## Kiến trúc khuyến nghị (chuẩn production)

1. Dùng runner nội bộ gắn nhãn theo nhóm workflow:
   - `self-hosted,linux,workstation` (hoặc nhãn tương đương mà runner thực tế đang dùng).
2. Mỗi workflow quan trọng nên chạy đúng cụm nhãn runner đã chuẩn hóa, ví dụ
   `runs-on: [self-hosted, Linux, workstation]`.
3. Giữ số lượng runner đủ để chịu được peak:
   - tối thiểu 1 runner luôn bật cho deploy,
   - thêm runner dự phòng cho `quality` khi mở rộng PR.
4. Chạy các workflow deploy dạng `workflow_dispatch` khi cần, hoặc trigger có điều kiện chặt hơn, thay vì mở rộng quá rộng.

### Quy tắc hardening bắt buộc

- Các workflow có `pull_request` mà thực thi checkout/install/build phải bỏ qua PR từ fork bằng điều kiện:
  `if: github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository`
- Các workflow chứa secret (NPM/token/Coolify/API) phải không chạy cho PR từ fork.
- `concurrency` theo nhóm workflow (`quality-*`, `deploy-*`, `sync-*`) để tránh queue chết chết giữa các run.

## Cách giảm minute theo 3 tầng

### Tầng 1 (không đổi chức năng)

- Audit trigger đang lặp:
  - trigger `push` và `pull_request` cho cùng một scope thì kiểm tra có workflow nào đè nhau chưa.
- Giảm push trigger trên workflow dùng để backup kiểm tra build/metadata khi already có `quality` trên cùng ref.
- Duy trì `paths` tối ưu: chỉ định đúng thư mục thay vì toàn repo.

### Tầng 2 (giảm rủi ro và chi phí)

- Bổ sung điều kiện fork-safe cho workflow nặng nếu cần cho PR từ fork:
  - dùng `pull_request` + `if` với danh sách repo tin cậy.
- Tách workload nặng thành nhóm:
  - `format + lint + unit + smoke` trước,
  - `deploy` sau khi `Quality` pass.

### Tầng 3 (quản trị tài khoản)

- Đặt branch protection cho `main`:
  - yêu cầu check `Quality`,
  - cấm force push trực tiếp (nếu chưa cần rollback nóng).
- Dùng `Actions minutes` dashboard theo repo + workflow để phát hiện workflow thổi nhiều.
- Đặt giới hạn giữ artifacts/cache (giảm storage leak cũng giảm cost profile tổng thể).

## Lịch vận hành đề xuất (ngắn hạn)

- Hàng tuần: review 10 workflow tiêu thụ nhiều phút nhất.
- Khi có đợt merge lớn: tạm đóng `workflow_dispatch` không cần thiết.
- Sau mỗi thay đổi `.github/workflows`, chạy nhanh một lần:
  - kiểm tra cú pháp yaml cơ bản,
  - test khô `act` hoặc dry-run khi có thể.

## Các bước triển khai tiếp theo cho bạn

1. Áp dụng đúng một runner nhãn cố định ở Coolify.
2. Đặt quy tắc branch protection cho `main` theo trên.
3. Theo dõi usage trong tháng đầu sau thay đổi:
   - nếu vẫn cao, cân nhắc gom `quality`/build thành gate đơn cho PR và deploy gating.
4. Nếu vẫn còn minute cao do workflow ngoài repo này, rà repo khác trong org và quy về cùng policy.

## Runbook áp dụng ngay (phần devops thực thi)

- Chạy audit minute ngay trong repo:
  - `bash scripts/ci/actions-minute-audit.sh`
  - `SINCE_DAYS=7 TOP_COUNT=10 bash scripts/ci/actions-minute-audit.sh`
  - khi có ngưỡng, bật fail-closed: `HOSTED_MINUTES_LIMIT=30`.
- Đưa vào CI:
  - workflow mới `.github/workflows/actions-minute-audit.yml` đã có `workflow_dispatch` và lịch `cron` để báo cáo mỗi tuần.
  - workflow này chạy trên runner nội bộ và lưu artifacts báo cáo.
- Chuẩn hóa nhãn runner:
   - `self-hosted`, `Linux`, `workstation` cho deploy/quality/smoke.
   - nếu cần chuyển sang nhãn mới (ví dụ thêm `coolify`), làm từng workflow theo lộ trình có kiểm soát, chạy cùng một runner nhóm để tránh deadlock.
- Tránh lãng phí song song:
  - giữ `concurrency` theo workflow family (`quality-*`, `deploy-*`, `sync-*`).
  - kiểm tra trùng trigger `push` + `pull_request` trên cùng workspace; tắt một trong hai nếu chức năng lặp.
- Kiểm soát `main`:
  - mở branch protection bắt buộc pass `Quality` trước `deploy-production`.
  - block force-push với `main` trừ nhóm vận hành.
- Dọn cache/artifact:
  - giảm retention mặc định cho artifacts/build cache.
  - bật `remove old workflow runs` theo kỳ trên dashboard nếu có.

## Coolify runner vs Jenkins (quyết định vận hành)

- Ưu tiên: giữ GitHub Actions + self-hosted runner (đang có) để gọi trực tiếp Coolify API.
- Nếu chạy Jenkins thì chỉ hợp lý khi đã có nhiều project không cùng nguồn, hoặc cần pipeline đa SCM.
- Trên hạ tầng hiện tại, Jenkins bổ sung ít giá trị nếu không có nhu cầu đó, nhưng có thể dùng như control plane riêng cho audit/khảo nghiệm thủ công sau này.

## Ghi chú về chi phí

Từ góc độ GitHub, giá và hành vi billing có thời điểm thay đổi theo thời gian; vì vậy cứ đối chiếu tài liệu chính thống của GitHub theo tháng chạy để tránh tính sai.
