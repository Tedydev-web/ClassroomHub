# GitHub Actions runner vận hành trên Coolify

## Phân tách trách nhiệm

- Coolify quản lý vòng đời container, restart policy, healthcheck và log của runner agent.
- GitHub Actions là nguồn log job và step. Coolify không hiển thị thay thế log của từng step.
- GitHub là nguồn sự thật về runner `online`, `busy`, queue và workflow conclusion.

## Topology chuẩn

Compose nguồn: `infra/github-runners/docker-compose.yaml`.

| Resource | Runner | Nhãn bắt buộc | Mục đích |
|---|---|---|---|
| deploy lane | `classroomhub-deploy` | `self-hosted,Linux,X64,coolify,deploy` | Gọi Coolify và deploy |
| CI lane 1 | `classroomhub-ci-1` | `self-hosted,Linux,X64,workstation,coolify,ci` | Quality và kiểm thử |
| CI lane 2 | `classroomhub-ci-2` | `self-hosted,Linux,X64,workstation,coolify,ci` | Quality và kiểm thử |

Mỗi runner có volume work/config riêng. Không dùng `docker compose down -v`, `docker volume prune` hoặc xóa volume runner khi chưa có inventory và xác nhận runner đã được deregister.

## Coolify variables

Khai báo trong Coolify, không commit vào Git:

- `RUNNER_TOKEN`
- `RUNNER_CI_TOKEN`
- `RUNNER_CI_3_TOKEN`

Token chỉ dùng khi tạo lại registration. Không đổi tên runner để né stale session: chỉ deregister khi GitHub báo `idle`, rồi reconcile bằng API Coolify.

## Kiểm tra sau deploy

```bash
docker compose --env-file /dev/null -f infra/github-runners/docker-compose.yaml config
gh api repos/Tedydev-web/ClassroomHub/actions/runners --paginate \
  --jq '.runners[] | [.name,.status,(.busy|tostring),([.labels[].name]|join(","))] | @tsv'
```

Kết quả đạt yêu cầu: ba runner `online`, `busy=false`, đúng nhãn; Coolify báo container `healthy`; GitHub workflow không còn `queued` quá 5 phút khi có runner idle.

## Chẩn đoán

```bash
docker ps --filter name=runner-
docker logs --since 15m runner-<coolify-resource>
```

Log đầy đủ của job xem tại URL run trong GitHub Actions. Nếu GitHub runner offline nhưng container healthy, kiểm tra kết nối outbound/DNS và log agent; nếu container unhealthy, kiểm tra `/runner` config volume và tiến trình `Runner.Listener`.

## Sau reboot

1. `docker` phải active.
2. Coolify control plane phải healthy.
3. Ba runner phải có `restart: unless-stopped` và chuyển về `online`.
4. Chạy một workflow `workflow_dispatch` nhỏ để kiểm tra queue → execution → notification.

Không coi `docker ps` hoặc thông báo “deployed” là bằng chứng workflow đã chạy; phải đối chiếu cả GitHub run và runtime health của ứng dụng.

## Reconcile từ Git

Chỉ chạy command này từ host vận hành hoặc một runner độc lập với Service runner. Không chạy `apply-and-start` từ chính runner sắp bị restart.

```bash
export COOLIFY_URL=https://coolify.example
export COOLIFY_TOKEN=stored-outside-git
export COOLIFY_RUNNER_SERVICE_UUID=stored-outside-git
infra/github-runners/reconcile-coolify-service.sh check
infra/github-runners/reconcile-coolify-service.sh apply-and-start
```

Command dùng Coolify API. Nó không sửa database hoặc file `/data/coolify` trực tiếp.

## Deregistration chuẩn

1. Kiểm tra runner trên GitHub là `online` và `busy=false`.
2. Tạo remove token ngắn hạn từ GitHub.
3. Chạy `deregister-runner.sh` trong đúng container runner.
4. Xác nhận runner biến mất khỏi GitHub trước khi reconcile/restart.

Không dọn config volume bằng wildcard. Nếu GitHub vẫn báo job đang chạy, hủy hoặc để job kết thúc trước; không đổi tên runner để vượt qua session cũ.

## Monitor ngoài container

`runner-monitor.sh` chạy bằng systemd timer mỗi hai phút, gọi GitHub API và chỉ gửi Telegram khi trạng thái thay đổi: runner offline hoặc queue vượt ngưỡng. Cài script vào `/usr/local/libexec/classroomhub-runner-monitor`, unit/timer vào `/etc/systemd/system/`, rồi dùng secret file root-owned `/etc/classroomhub/runner-monitor.secrets` (`0600`).

Secret file cần `GITHUB_TOKEN` read-only cho repository, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`; không commit file này. Sau khi cài:

```bash
systemctl daemon-reload
systemctl enable --now classroomhub-runner-monitor.timer
systemctl start classroomhub-runner-monitor.service
```
