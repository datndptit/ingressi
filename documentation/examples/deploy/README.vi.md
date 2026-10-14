# Bộ mẫu triển khai Ingressi (Docker rootless) — cụm 2 node tham chiếu

Đây là cấu hình thực tế đang chạy của cụm tham chiếu: 1 load balancer phía trước, 2 VM Ubuntu
mỗi node chạy stack Ingressi dưới Docker rootless (user `dockerwaf`) — web + caddy (WAF, module
coraza-mlcheck) + crowdssec + clickhouse (+ keeper) + geoipupdate + l4-port-manager, kèm Argus ML
sidecar (compose project riêng) và kit bật ClickHouse replication.
Dùng bộ này để dựng cụm mới cho ra kết quả tương đương.

## Kiến trúc

- N VM sau 1 load balancer. Mỗi node chạy **cùng một stack ingressi** dưới user `dockerwaf` (rootless).
- Một node (ở cụm tham chiếu là node2) chạy thêm **ClickHouse Keeper** → `docker-compose.keeper.yml`.
- ClickHouse: 1 shard, mỗi node 1 replica (`analytics.*` = ReplicatedMergeTree qua Keeper, đồng bộ
  interserver cổng 9009). Sau khi chuyển đổi, bảng gốc giữ lại thành `*_local_backup`.
- TLS / cert / proxy-host / global WAF: quản lý qua UI Ingressi (nằm trong DB, không phải file).
- Argus sidecar: repo riêng, chạy như compose project độc lập (xem `argus-sidecar/` trong bộ này).

## Điều kiện tiên quyết trên MỖI node (Ubuntu)

- User `dockerwaf`, Docker **rootless** hoạt động: subuid/subgid `165536:65536`, systemd linger bật.
- Override rootlesskit — `~/.config/systemd/user/docker.service.d/override.conf`:

  ```
  [Service]
  Environment="DOCKERD_ROOTLESS_ROOTLESSKIT_FLAGS=--net=pasta --port-driver=implicit"
  ```

- Bind cổng 80 — `/etc/sysctl.d/99-unprivileged-ports.conf`:

  ```
  net.ipv4.ip_unprivileged_port_start=80
  ```

- Quyền cho uid container **1001** (host **166536** dưới rootless): ACL traversal
  `setfacl -m u:166536:x /home/dockerwaf` (+ thư mục model nếu dùng); log dir `caddy-logs` thuộc
  group `166536`, mode `2770`.
- Repo đặt tại **`/home/dockerwaf/ingressi`** (các file compose tham chiếu đường dẫn tuyệt đối này).
- Cổng cần trống: `80/443/3000/9009/9181` (sau LB thì chỉ cần LB tới được).
- **Lưu ý quan trọng**: rootlesskit đời hiện tại không bind được địa chỉ LAN cụ thể → publish cổng
  dạng wildcard (`"3000:3000"`, `"9009:9009"`, `"9181:9181"`) như trong overlay có sẵn.

## File trong bộ này

| File | Dùng cho |
|---|---|
| `docker-compose.rootless.yml` | **mọi node** — bản chung, giống hệt nhau giữa các node |
| `docker-compose.keeper.yml` | chỉ node chạy Keeper |
| `node1/`, `node2/` `clickhouse/*.xml` | cấu hình CH per-node (file `replication.xml` được mount; `interserver.xml` là bản cũ, hiện không dùng) |
| `env.example` | mẫu `.env` đầy đủ 28 khoá |
| `scripts/gen-env.py` | sinh `.env` (tùy chọn, thay cho copy tay) |
| `ch-repl/` | kit bật ClickHouse replication — xem `ch-repl/README.vi.md` |
| `argus-sidecar/compose.rootless.yaml` | overlay build sidecar uid 1001 (đặt trong repo argus-sidecar) |

## Trình tự triển khai

1. **Clone + quyền**: clone repo về `/home/dockerwaf/ingressi`, sau đó `chmod -R a+rX` cây source
   (nếu clone dưới umask 077 thì file 600 sẽ làm image build không đọc được code).
2. **`.env`**: copy `env.example` → `<repo>/.env`; sinh secret (`openssl rand -hex 32`, riêng
   `CLICKHOUSE_PASSWORD` dùng `-hex 24`); đặt `HOSTNAME`, `BASE_URL` theo node.
   **Node chạy Keeper** thêm `:docker-compose.keeper.yml` vào cuối cả `COMPOSE_FILE` và
   `COMPOSE_EXTRA_FILES`. (Hoặc chạy `python3 scripts/gen-env.py <hostname> <base-url> [--keeper]`.)
3. **ClickHouse XML**: copy `node1|node2/clickhouse/*.xml` phù hợp vào `<repo>/deploy/clickhouse/`
   (sửa macros replica + `interserver_http_host` + host keeper theo cụm của bạn).
4. **Kiểm tra cấu hình**: `docker compose config -q` — và tùy chọn `docker compose config --hash "*"`
   để so hash từng service giữa các node khi đối chiếu.
5. **Build + chạy**: pull các image hạ tầng → build 3 image ứng dụng
   (`docker compose build web caddy l4-port-manager`) → `docker compose up -d`.
6. **Argus sidecar**: theo repo `argus-sidecar` + overlay mẫu trong bộ này; up sidecar **trước** khi
   bật rule ML (sidecar tạo volume socket `ingressi-argus-run`).
7. **ClickHouse replication**: theo `ch-repl/README.vi.md` (P1: mount replication.xml + pin image;
   P3: staging → copy → rename; có drill chịu lỗi).
8. **CrowdSec / GeoIP**: bật qua `COMPOSE_PROFILES`. Bouncer key chính là `CROWDSEC_API_KEY`
   (mỗi node một khoá; config caddy dùng placeholder `{env.CROWDSEC_API_KEY}`).
9. **Cert + host + WAF global**: dán cert / import proxy-hosts qua UI; bật CRS
   (`load_owasp_crs=true`); custom directives ML xem `documentation/examples/argus/`.
10. **Nghiệm thu**: so hash giữa các node (`docker compose config --hash`, sha256 file overlay),
    kiểm tra `cscli` (LAPI/bouncer), dòng `mlcheck` trong log caddy, và đếm bản ghi ClickHouse
    khớp nhau giữa các node.

## Ghi chú vận hành (rút từ cụm tham chiếu)

- **Không đổi tên** `docker-compose.rootless.yml` (l4-port-manager phụ thuộc tên này). Node chạy
  Keeper tách phần keeper ra file riêng để bản chung giống hệt nhau giữa các node.
- Các giá trị `.env` khác nhau giữa các node: `HOSTNAME`, `BASE_URL`, các secret, và (node keeper)
  `COMPOSE_FILE` / `COMPOSE_EXTRA_FILES`.
- Đổi danh sách file compose = sửa `.env`; service `l4-port-manager` nhận `${COMPOSE_EXTRA_FILES}`
  nên tự cập nhật ở lần recreate kế tiếp.
- Backup định kỳ bằng tar `.env` + compose + `deploy/` + file version (mẫu `m14_backup.sh`).
- Khi update stack: `docker compose up -d` — chỉ container có cấu hình thay đổi mới bị recreate.
