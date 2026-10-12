# Argus Sentinel v4 cho Ingressi hiện tại

Rà soát ngày 12/10/2026, trên commit Ingressi
`b0802aa8d442048092d8d901bcb8d87d1d742aaf` tại checkout này.
Production mục tiêu: Ubuntu 24.04 amd64, Docker Engine + Compose v2.
Chỉ sử dụng custom rule ML; không thêm UI/API/settings/database.

## Lấy code từ fork

```sh
git clone --branch develop https://github.com/datndptit/ingressi.git
cd ingressi
cp .env.example .env
```

Fork đã chứa tích hợp bên dưới, không cần áp dụng patch thủ công. Điền các
biến bắt buộc của Ingressi vào `.env`, chuẩn bị model và bật overlay ML theo
hướng dẫn này. Với cài mới, sau bước build và healthcheck sidecar, dùng
`docker compose up -d --no-build --pull never` để khởi động toàn bộ stack;
pull các image service nền trước bằng
`docker compose pull web docker-socket-proxy l4-port-manager`.

## Build đúng theo Ingressi

Ingressi vẫn dùng xcaddy bên trong, nhưng không build bằng lệnh cố định
`xcaddy build <version>` do người vận hành tự viết. Luồng build là:

1. `docker/caddy/Dockerfile` đọc manifest `go.mod`/`go.sum`.
2. `update-compatibility-pins.sh` xử lý tương thích cel-go theo Caddy đã ghim.
3. Cài xcaddy theo phiên bản trong manifest.
4. `build.sh` lấy phiên bản Caddy và từng module từ manifest rồi build.
5. `tools.go` blank-import các module để `go mod tidy`/Dependabot giữ chúng.

Đã thêm `github.com/datndptit/coraza-mlcheck v0.1.0` vào manifest, import
và danh sách module; giữ nguyên phiên bản cùng các provider hiện có, kể cả
Bunny DNS. Dockerfile chuẩn bị `/run/argus` theo PUID/PGID của Caddy.
Không cần source plugin local, replace đường dẫn hay protoc.

Các phiên bản **quan sát trong build đã kiểm chứng**, không phải bộ số
phiên bản cần chép cứng sang script:

| Thành phần | Phiên bản |
|---|---|
| Caddy / xcaddy | 2.11.7 / 0.4.7 |
| coraza-caddy / Coraza | 2.6.1 / 3.8.1 |
| CRS | 4.25.0 |
| gRPC Go / protobuf Go | 1.83.2 / 1.36.12 |
| coraza-mlcheck / argus-sidecar | 0.1.0 / 0.1.1 |

## Sidecar stack riêng

Code public:
[coraza-mlcheck](https://github.com/datndptit/coraza-mlcheck) và
[argus-sidecar](https://github.com/datndptit/argus-sidecar).
Ingressi **không** chạy sidecar trong stack của mình: sidecar là một stack
Compose riêng, hai bên chỉ chia sẻ volume socket. Model, tokenizer và dữ liệu
huấn luyện không nằm trong repo/image. Chuẩn bị bundle đáng tin cậy gồm
`model.onnx`, `tokenizer.json`, `config.json`, `preprocess.py`,
`inference_cpu.py`, rồi dựng và chạy sidecar theo README của repo đó:

```sh
git clone --branch v0.1.1 https://github.com/datndptit/argus-sidecar.git
cd argus-sidecar
sudo python3 scripts/prepare-model.py /path/to/argus_sentinel_v4 /opt/argus/models/v4
sudo chown -R 10000:10000 /opt/argus/models/v4
sudo chmod 0750 /opt/argus/models/v4
sudo find /opt/argus/models/v4 -maxdepth 1 -type f -exec chmod 0640 {} +
cp .env.example .env
# Edit .env: persist the model path, socket volume and socket path.
docker compose config --quiet
docker compose build --pull
docker compose up -d
docker compose exec argus-sidecar python -m argus_sidecar.healthcheck
```

Lưu `.env` ngay trong repo sidecar để phiên SSH sau không phụ thuộc các lệnh
`export`. Nếu nâng từ v0.1.0, lấy tag v0.1.1 và giữ `.env` hiện có; nếu chưa
có thì tạo từ `.env.example` rồi điền đúng đường dẫn model đã triển khai.
Cả `ARGUS_SOCKET_VOLUME` và `ARGUS_SOCKET` phải khớp trong `.env` của hai
stack. Socket tùy chỉnh phải nằm trong `/run/argus`. Nếu đổi socket, recreate
cả sidecar lẫn Caddy để nhận cấu hình mới.

Manifest kiểm tra toàn vẹn bundle; không xác thực tác giả. Hai file Python
được runtime nạp nên phải lấy bundle từ nguồn tin cậy. Sidecar đặt tên
volume socket bằng `ARGUS_SOCKET_VOLUME` (mặc định `ingressi-argus-run`);
overlay Ingressi tham chiếu đúng tên đó dưới dạng volume external, nên hai
stack dùng chung socket dù chạy ở project Compose khác nhau. Với volume mới,
khởi động sidecar trước để volume được tạo với đúng quyền (image sidecar đã
chuẩn bị sẵn `/run/argus`).

## Cấu hình Ingressi

Trong `.env` hiện có của Ingressi, giữ thông tin cấu hình/credentials đang dùng
và thêm (các lệnh chạy tại thư mục checkout Ingressi đã có thay đổi này):

```dotenv
COMPOSE_FILE=docker-compose.yml:docker-compose.argus.yml
ARGUS_SOCKET_VOLUME=ingressi-argus-run
ARGUS_SOCKET=/run/argus/argus.sock
ARGUS_TIMEOUT_MS=50
```

Giữ thêm các overlay khác nếu hệ thống đang dùng. Dấu phân cách `:` ở đây
là cho Ubuntu. `ARGUS_SOCKET_VOLUME` phải khớp giá trị đã dùng cho stack
sidecar. Volume `argus-run` trong overlay là **external**: compose không tạo,
không xóa, nên `docker compose down -v` của Ingressi không thể phá socket
đang sống. Caddy và sidecar mặc định UID/GID 10000:10000, socket 0660.
Không mở cổng TCP cho sidecar.

Nếu PUID/PGID khác 10000: dựng lại sidecar với `--build-arg PUID=... PGID=...`
theo README sidecar và chỉnh quyền model/volume theo ID đó; phía Caddy đặt
`PUID`/`PGID` trong `.env` như mọi service khác của Ingressi. Không dùng
image dựng sẵn UID 10000 với Caddy có ID khác.

## Build, rollout và rollback

```sh
docker compose config --quiet
docker compose build caddy
docker compose up -d --no-deps --no-build --pull never caddy l4-port-manager

docker compose exec caddy caddy build-info | grep github.com/datndptit/coraza-mlcheck
docker compose exec caddy caddy list-modules | grep dns.providers.bunny
```

Các lệnh này cập nhật một stack Ingressi đã được cấu hình; stack sidecar
(mục trên) phải đang chạy trước vì volume socket là external — thiếu nó
compose báo lỗi thiếu volume, không âm thầm chạy Caddy thiếu ML. Nếu cài mới,
khởi tạo các service còn lại theo hướng dẫn Ingressi và luôn giữ overlay ML.
Có thể build riêng binary image mà không cần credentials Compose bằng:

```sh
docker build -f docker/caddy/Dockerfile -t ingressi-caddy-argus:local .
```

Overlay đã đặt `COMPOSE_EXTRA_FILE=/compose/docker-compose.argus.yml` cho
**l4-port-manager**. Service này gọi Compose với `-f` rõ ràng nên không tự
đọc danh sách `COMPOSE_FILE`; thiếu extra file sẽ mất image ML/socket khi
đổi cổng L4 và tạo lại Caddy. Cần recreate cả port manager như lệnh trên.
Nếu đang dùng `COMPOSE_EXTRA_FILE` cho cấu hình khác, gộp các cấu hình cần
thiết vào file đó.

Sau khi binary và sidecar sẵn sàng, bật WAF + **Load OWASP CRS**, dán
`documentation/examples/argus/detect.conf` vào custom directives hiện có.
Chạy detect trước; đổi `block.conf` với WAF mode **On** khi đã đánh giá
false positive trên traffic thật. Mỗi directive phải nằm trên một dòng.

Rollback: gỡ toàn bộ rule ML và apply trước khi đổi về image Caddy không
có plugin. Giữ cả image digest và thư mục model có version để rollback.
Model mount bên ngoài nên chỉ đổi image không rollback được model.

## Hành vi đã đối chiếu với Ingressi mới

- `src/lib/caddy-waf.ts` nhận đủ ba bộ rule mẫu, giữ `mlcheck` và
  `ctl:auditEngine=On`; custom rules chạy sau CRS. Detect HTTP 200 vẫn có
  audit record nhờ action ép audit trên rule verdict.
- ML không mở lại request CRS đã chặn. Lỗi sidecar làm ML fail-open, CRS
  vẫn hoạt động độc lập. Dùng `@streq 0` để chặn; verdict rỗng không khớp.
- CRS bật body access và processor JSON/XML/form/multipart; Ingressi bổ
  sung RAW cho content type còn lại. Plugin đọc raw buffer và giữ nguyên
  body gửi upstream. Giữ CRS bật trong cấu hình được hỗ trợ này.
- Ngưỡng float theo host dùng `detect-tx-threshold.conf`; global directives
  chạy trước host directives khi merge. Không đặt threshold host sau lệnh
  mlcheck global; đặt cả bộ ở host hoặc dùng override. Tránh trùng rule ID.
- `allowWebsocket=true` chỉ bypass **upgrade handshake**, HTTP thường vẫn
  qua WAF/ML. WebSocket frames và traffic L4 không được ML HTTP kiểm tra.
- Caddy đọc các biến timeout, inflight, queue, circuit và metrics từ
  overlay; sidecar đọc cấu hình của nó từ stack riêng (CPU/memory/PID cap,
  read-only filesystem nằm trong repo sidecar). Hai bên chỉ chung UDS.

## Kết quả kiểm chứng

- `go mod tidy`: chỉ thêm một require plugin và hai checksum, không đổi
  các pin của Ingressi.
- 221 test Vitest thuộc build, WAF builder/filter, tuning, exclusions và
  Argus đạt. Plugin race test đạt với dependency graph của Ingressi mới.
- Build đầy đủ Dockerfile Ingressi đạt; build-info xác nhận các dependency
  bên trên, không có local replacement. Fixture do WAF builder sinh ra
  có embedded CRS được Caddy validate thành công.
- HTTP với image sidecar GHCR và model thật: JSON/form/XML/RAW/multipart
  và body vượt memory limit đến upstream không đổi; SQLi/XSS chặn 403;
  detect trả 200 có audit; threshold riêng và threshold sai đúng hành vi.
- HTTP thường vẫn bị chặn khi allowWebsocket bật, upgrade handshake được
  bypass. Sidecar dừng: ML fail-open/circuit open, CRS vẫn chặn; sidecar
  khởi động lại: ML tự phục hồi.
- Compose merge với overlay ML và overlay cổng L4 giữ đúng image, biến môi
  trường, volume socket external dùng chung với stack sidecar và cấu hình
  extra file của port manager; overlay không chứa service sidecar.

Workflow public [Ingressi compatibility](https://github.com/datndptit/coraza-mlcheck/actions/workflows/ingressi.yml)
build lại đúng revision được ghim bằng Dockerfile upstream;
[run Ubuntu 24.04 ngày 12/10/2026 đã đạt](https://github.com/datndptit/coraza-mlcheck/actions/runs/38203110379).
Hướng dẫn và
patch portable nằm tại [docs/ingressi.md](https://github.com/datndptit/coraza-mlcheck/blob/main/docs/ingressi.md).
Tích hợp Ingressi nằm trên `develop` của fork; sửa hướng dẫn/CI của hai repo
thành phần nằm trên `main`. Plugin tiếp tục dùng `v0.1.0`; sidecar dùng `v0.1.1` để sửa truyền cấu hình
Compose và lưu `.env`. Không đổi tag đã phát hành. Chưa deploy lên VM production hay benchmark tải.
Coraza dùng experimental plugin API nên phải chạy lại kiểm chứng khi nâng
phiên bản Ingressi/Coraza, không suy rộng kết quả này cho mọi bản tương lai.
