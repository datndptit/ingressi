# CrowdSec HTTP bouncer cho Ingressi (fork `datndptit/ingressi`)

Tích hợp CrowdSec bản đầu: bật/tắt enforcement bằng REST API (không có giao
diện web), chạy chung với Caddy của Ingressi. Gồm:

- **Caddy của fork** — image build từ repo này, mang thêm CrowdSec HTTP
  bouncer (không có AppSec, không có bouncer L4).
- **Overlay `docker-compose.crowdsec.yml`** — CrowdSec Security Engine
  `v1.8.1` + PostgreSQL `17-alpine` riêng, chỉ chạy trong mạng Docker.
- **Ingressi** — quản lý bật/tắt: một công tắc global và mode từng proxy host
  (`inherit | on | off`).

Chuỗi xử lý request (giữ nguyên thứ tự bộ lọc sẵn có của Ingressi):

```text
HTTP request
  → CrowdSec HTTP bouncer (chỉ khi host được bật)
  → Blocked sources
  → rate limit
  → Coraza (WAF)
  → các handler hiện có → upstream
```

Luồng dữ liệu:

```text
Caddy access.log (JSON) → CrowdSec (parser crowdsecurity/caddy) → LAPI ↔ PostgreSQL riêng
                                                                        ↕ CAPI
                                                        cache quyết định trong Caddy
```

Bouncer chỉ nói chuyện với **LAPI**; Security Engine đọc log và tự đăng ký
**CAPI** (Community Blocklist). Bouncer chạy streaming: quyết định được giữ
trong RAM của Caddy, cập nhật theo nhịp poll (~15 giây), không gọi LAPI cho
từng request.

**Bản này không gồm**: CrowdSec AppSec, bouncer L4 (TCP/UDP), dashboard
CrowdSec, API quản lý ban, đồng bộ master/slave.

---

## 1. Chuẩn bị

- Linux amd64, Docker Engine + Docker Compose v2 (Ubuntu 24.04 là mục tiêu đã
  xác nhận).
- Bản checkout của repo này (fork) — image `web`, `caddy` và `l4-port-manager` được build từ đây,
  image không nằm trên registry nào.
- Thêm vào `.env` (giữ nguyên các biến bắt buộc sẵn có):

```dotenv
COMPOSE_FILE=docker-compose.yml:docker-compose.crowdsec.yml

# Dùng chung với overlay Argus (khi có cả hai):
# COMPOSE_FILE=docker-compose.yml:docker-compose.argus.yml:docker-compose.crowdsec.yml

# Khóa bouncer "ingressi". Sinh bằng: openssl rand -hex 32
CROWDSEC_API_KEY=
# Mật khẩu PostgreSQL riêng của CrowdSec. Sinh bằng: openssl rand -hex 32
CROWDSEC_POSTGRES_PASSWORD=
```

Chỉ CrowdSec: port manager mặc định giữ riêng overlay CrowdSec. Khi chọn thêm
overlay Argus trong `COMPOSE_FILE`, biến `COMPOSE_EXTRA_FILE` của Argus được
đặt trước CrowdSec khi recreate. File Argus có trong repo không tự kích hoạt nó.
Nếu cần chỉ định nhiều overlay khác, đặt đủ các file theo đúng thứ tự khởi động:

```dotenv
# COMPOSE_EXTRA_FILES=/compose/docker-compose.argus.yml:/compose/docker-compose.crowdsec.yml
```

## 2. Cài đặt

Chạy tại thư mục repo:

```sh
# Build cả port manager của fork để hỗ trợ giữ nhiều overlay.
docker compose build web caddy l4-port-manager
# Dựng toàn bộ stack, gồm crowdsec + crowdsec-postgres.
docker compose up -d
docker compose ps
```

Với stack đã chạy, vẫn phải build và recreate `l4-port-manager`; image upstream
không có thay đổi hỗ trợ `COMPOSE_EXTRA_FILES` của fork:

```sh
docker compose up -d --no-deps --no-build --pull never --force-recreate l4-port-manager
```

Kiểm tra nhanh:

```sh
docker compose exec crowdsec cscli lapi status     # LAPI sống, credentials OK
docker compose exec crowdsec cscli capi status     # CAPI đã đăng ký
docker compose exec crowdsec cscli bouncers list   # có bouncer "ingressi"
docker compose exec caddy caddy build-info | grep caddy-crowdsec-bouncer
```

CAPI đăng ký ở lần chạy đầu và lưu trong volume `crowdsec-config`
(`/etc/crowdsec/online_api_credentials.yaml`) — container tạo lại không mất.
LAPI và PostgreSQL không publish cổng ra host; muốn xem từ ngoài chỉ qua
`docker compose exec`.

## 3. Bật access logging và kiểm tra CrowdSec đọc log

1. Trong Ingressi: **Settings → Logging** — bật, format **JSON**, Apply.
2. Gửi ít nhất một request qua host thật để Caddy tạo `/logs/access.log`:

```sh
docker compose exec caddy ls -l /logs/access.log
```

Nếu file chưa tồn tại lúc CrowdSec khởi động, engine bỏ qua acquisition
(log `No matching files for pattern /logs/access.log`) — tạo file trước rồi
khởi động lại engine:

```sh
docker compose restart crowdsec
```

3. Xác nhận parser đọc được log:

```sh
docker compose exec crowdsec sh -c 'tail -n 5 /logs/access.log' | \
  docker compose exec -T crowdsec cscli explain -f - --type caddy -v
```

Nên thấy các field đã tách (`remote_ip`, `http_path`, ...). Collection dùng
sẵn: `crowdsecurity/caddy` (parser + scenario HTTP chung).

## 4. Bật enforcement bằng REST API

Tạo API token trong Ingressi (Profile → API tokens) rồi dùng
`Authorization: Bearer <token>`:

```sh
BASE=https://<địa-chỉ-ingressi-của-bạn>
TOKEN=<dán API token của bạn>

# Bật toàn cục (mặc định cho các host mode "inherit")
curl -sS -X PUT "$BASE/api/v1/settings/crowdsec" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"enabled": true}'

# Danh sách host + mode + trạng thái hiệu lực
curl -sS "$BASE/api/v1/crowdsec/hosts" -H "Authorization: Bearer $TOKEN"

# Ngoại lệ từng host: on | off | inherit (inherit = theo global)
curl -sS -X PUT "$BASE/api/v1/crowdsec/hosts/12" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"mode": "off"}'
```

Quyền: global cần `settings:read/write`; host cần `proxy_hosts:read/write` và
tôn trọng tag scope của custom role (host ngoài scope trả 404). Mọi thay đổi
đi qua kiểm tra hợp lệ, change approval (nếu có policy), audit log và được áp
dụng ngay vào Caddy; nếu Caddy từ chối cấu hình, API trả **502** với nghĩa
"đã lưu nhưng chưa áp dụng" (Caddy tiếp tục chạy cấu hình cũ).

Lưu ý: khi tắt enforcement (global false và mọi host không `on`), Security
Engine **vẫn** đọc log và đồng bộ CAPI — chỉ Caddy ngừng chặn.

## 5. Thử chặn thật (nghiệm thu)

```sh
# Thêm decision ban cho một IP thử nghiệm
docker compose exec crowdsec cscli decisions add --ip 203.0.113.9 --duration 5m --reason "acceptance"

# Chờ tối đa ~15 giây (nhịp poll của bouncer) rồi gọi host đã bật
curl -i https://your-host/            # từ IP bị ban: nhận 403, không tới upstream

# Xóa decision, truy cập phục hồi
docker compose exec crowdsec cscli decisions delete --ip 203.0.113.9
```

Kiểm tra thêm: IPv6/CIDR, và chống giả `X-Forwarded-For` từ nguồn không tin
cậy — bouncer dùng đúng cơ chế client IP + `trusted_proxies` sẵn có của
Ingressi/Caddy; chỉ cấu hình trusted proxies khi node thật sự đứng sau proxy
tin cậy (ADC).

## 6. Vận hành

- **LAPI mất kết nối**: Caddy tiếp tục phục vụ theo cache quyết định trong
  RAM; không bảo đảm cache còn mới/nguyên vẹn sau restart (đến nhịp poll kế
  tiếp mới đầy lại). `enable_hard_fails=false` — LAPI lỗi không làm Caddy dừng.
- **Xoay khóa bouncer**: phải xóa bouncer cũ trước (image không cập nhật
  bouncer đã tồn tại):

```sh
docker compose exec crowdsec cscli bouncers delete ingressi
# đổi CROWDSEC_API_KEY trong .env
docker compose up -d --force-recreate crowdsec caddy
```

- **Sao lưu**: database `docker compose exec crowdsec-postgres pg_dump -U crowdsec crowdsec > crowdsec-backup.sql`;
  credentials + cấu hình nằm trong volume `crowdsec-config` (`/etc/crowdsec`).
- **Log engine**: `docker compose logs -f crowdsec`; metrics: `docker compose exec crowdsec cscli metrics`.
- **Rotation log Caddy**: file cũ được nén `.gz`; CrowdSec theo dõi file đang
  ghi và tiếp tục sau rotation. File nén không được đọc lại (chấp nhận).

## 7. Rollback

1. Đưa enforcement về 0 trước: global `false` và mọi host về `inherit` qua
   API (hoặc xóa hẳn group — xem mục 8).
2. Khi overlay vẫn còn trong `COMPOSE_FILE`, dừng và gỡ riêng hai container:

   ```sh
   docker compose stop crowdsec crowdsec-postgres
   docker compose rm -f crowdsec crowdsec-postgres
   ```

3. Bỏ overlay khỏi `COMPOSE_FILE` (và `COMPOSE_EXTRA_FILES`), build/pull lại
   image `caddy`/`web`/`l4-port-manager` đúng bản cần dùng rồi `docker compose up -d`.
4. Mặc định giữ lại các volume CrowdSec để có thể khôi phục. Nếu muốn xóa hẳn,
   sao lưu trước, xác định đúng tên project rồi liệt kê từng volume:

   ```sh
   PROJECT=ingressi # thay bằng tên project thực tế trong `docker compose ls`
   docker volume ls --filter "label=com.docker.compose.project=$PROJECT" --filter 'label=com.docker.compose.volume=crowdsec-config'
   docker volume ls --filter "label=com.docker.compose.project=$PROJECT" --filter 'label=com.docker.compose.volume=crowdsec-data'
   docker volume ls --filter "label=com.docker.compose.project=$PROJECT" --filter 'label=com.docker.compose.volume=crowdsec-postgres-data'
   ```

   Chỉ dùng `docker volume rm TEN_VOLUME` với từng tên đã xác nhận từ ba lệnh
   trên. Việc này xóa decisions, dữ liệu engine và credentials CAPI. Không dùng
   `docker compose down --volumes` để gỡ CrowdSec: lệnh đó xóa cả volume Ingressi
   và Caddy trong cùng project, bao gồm database dashboard và chứng chỉ.

Trước khi bỏ overlay, bắt buộc mọi host `inherit` + global `false` (bước 1):
cấu hình Caddy còn handler `crowdsec` mà image không có module sẽ bị Caddy
từ chối và mọi thay đổi sau đó không áp dụng được.

## 8. Gỡ cấu hình CrowdSec khỏi dữ liệu Ingressi

Enforcement không nằm trong mọi response mặc định: group `crowdsec` trong
settings (export/import, config history) và khóa `meta.crowdsec` trong từng
proxy host (chỉ chứa `{mode: "on"|"off"}`, mode `inherit` không lưu gì).
Đặt global `false` + host `inherit` là đủ để ngừng dùng; không cần migration.

## 9. Giới hạn đã biết (v1)

- Chỉ một stack: chưa đồng bộ cấu hình CrowdSec qua instance sync
  (master/slave không nằm trong phạm vi bản này).
- Community Blocklist: mức nhận (Lite/đầy đủ) phụ thuộc mức đóng góp tín hiệu
  thực tế; đọc log **không** bảo đảm nhận blocklist đầy đủ.
- URL LAPI (`http://crowdsec:8080/`), chu kỳ poll `15s` là hằng số triển khai
  trong `src/lib/caddy-crowdsec.ts` (mặc định của overlay); đổi deployment
  khác cần sửa hằng số + build lại web.
- Bouncer pin `v0.14.1` (release mới nhất tại thời điểm này). Upstream `main`
  đã có commit hỗ trợ CrowdSec ≥1.7 và decision-precedence chưa phát hành;
  nếu gặp vấn đề tương thích với LAPI 1.8.x, nâng pin trong
  `docker/caddy/go.mod` + `docker/caddy/build.sh` (một dòng) và build lại.
- Request bị CrowdSec chặn **không** đi qua Coraza nên không phải WAF event:
  trong Security events/Analytics, chúng là 403 từ bouncer (access log), không
  phải sự kiện Coraza.

## 10. Câu lệnh hữu ích

```sh
docker compose exec crowdsec cscli decisions list                 # quyết định hiện có
docker compose exec crowdsec cscli alerts list                    # cảnh báo từ log
docker compose exec crowdsec cscli collections list               # collection đã cài
docker compose exec crowdsec cscli metrics                        # số dòng đọc/parse
docker compose exec crowdsec cscli capi status                    # trạng thái CAPI
docker compose exec crowdsec-postgres psql -U crowdsec -d crowdsec -c '\dt'
```
