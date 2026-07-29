# GitHub Actions runner vận hành trên Coolify

## Phân tách trách nhiệm

- Coolify quản lý vòng đời container, restart policy, healthcheck và log của runner agent.
- GitHub Actions là nguồn log job và step. Coolify không hiển thị thay thế log của từng step.
- GitHub là nguồn sự thật về runner `online`, `busy`, queue và workflow conclusion.

## Topology chuẩn

Compose nguồn: `infra/github-runners/docker-compose.yaml`.

| Resource | Runner | Nhãn bắt buộc | Mục đích |
|---|---|---|---|
| deploy lane | `classroomhub-coolify-r4` | `self-hosted,Linux,X64,coolify,deploy` | Gọi Coolify và deploy |
| CI lane 2 | `classroomhub-ci-2-r4` | `self-hosted,Linux,X64,workstation,coolify,ci` | Quality và kiểm thử |
| CI lane 3 | `classroomhub-ci-3-r4` | `self-hosted,Linux,X64,workstation,coolify,ci` | Quality và kiểm thử |

Mỗi runner có volume work/config riêng. Không dùng `docker compose down -v`, `docker volume prune` hoặc xóa volume runner khi chưa có inventory và xác nhận runner đã được deregister.

## Coolify variables

Khai báo trong Coolify, không commit vào Git:

- `RUNNER_TOKEN`
- `RUNNER_CI_TOKEN`
- `RUNNER_CI_3_TOKEN`

Token chỉ dùng khi tạo lại registration. Config volume giữ registration hiện tại, nên redeploy bình thường không cần token mới.

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
