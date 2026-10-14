# Kit bật ClickHouse replication — 1 shard, N replica qua Keeper

Bộ script/SQL thực tế dùng để chuyển cụm từ ClickHouse đơn lẻ sang 1 shard nhiều replica
(cụm tham chiếu: 2 node, Keeper chạy trên node2). Cách làm giữ nguyên dữ liệu cũ:
bảng mới = `ReplicatedMergeTree`, bảng gốc được đổi tên thành `*_local_backup` (giữ đến khi
xác minh xong mới drop).

## Trình tự (P1 → P3 theo comment đầu mỗi file)

**P1 — hạ tầng replica:**
1. `ch_pw_init.sh` — sinh mật khẩu interserver dùng chung (chạy 1 lần trên 1 node; giá trị không in ra).
2. `ch_edit_compose.py <role>` — pin image CH + đổi mount `interserver.xml` → `replication.xml`
   (chạy trên từng node; có guard idempotent).
3. `ch_finalize_xml.sh node1|node2` — render `deploy/clickhouse/replication.xml` từ
   `replication.xml.tmpl` (macros replica, host keeper, interserver host).
   **Sửa mapping REPLICA/KEEPER/NODEIP trong script cho cụm của bạn.**
   Hai lưu ý đã đúc kết trong script: file xml phải **644** (CH drop sang uid 101 trước khi merge
   config.d) và ghi **IN-PLACE** khi file đích tồn tại (bind mount giữ inode; `mv` đè sẽ khiến
   container đọc inode cũ).
4. Restart ClickHouse (và keeper ở node tương ứng) → kiểm tra `system.replicas` sạch, keeper `ruok`.

**P3 — chuyển dữ liệu (zero-loss):**
5. Dừng web (cả cụm) → `01-create-staging.sql` (bảng staging ReplicatedMergeTree, path chuẩn
   `/ingressi/analytics/01/...`) → `02-copy-own-data.sql` (mỗi node tự copy dữ liệu của mình,
   replication hợp nhất dữ liệu 2 node).
6. `ch_wait_stage.py <traffic_target> <waf_target> <timeout_s>` — chờ đồng bộ;
   `verify-fingerprints.py old1.tsv old2.tsv new1.tsv new2.tsv` — xác nhận union(nguồn 1 + nguồn 2)
   == cả 2 replica (count + 2 fingerprint độc lập thứ tự).
7. `03-rename-swap.sql` trên từng node — hoán đổi tên bảng (bản gốc thành `*_local_backup`).
8. `ch_edit_env_url.py` — thêm tham số quorum vào `CLICKHOUSE_URL`; up lại web.

**Kiểm tra / drill:**
- `smoke-insert.sql` (node ghi) + `smoke-check.sql` (node còn lại đọc được) — replication 2 chiều.
- `drill-write-a.sql` / `drill-write-b.sql` + `drill-seen.sql` — drill chịu lỗi (tắt keeper /
  mất 1 node vẫn ghi được, khi node quay lại thấy đủ bản ghi).
- `fingerprint-original.sql` / `fingerprint-staging.sql` — chụp fingerprint từng giai đoạn
  (count + sumWithOverflow + groupBitXor trên cityHash64).

## Ghi chú

- `.interserver_pw` **không được commit** — kit tự sinh trên node và giá trị không bao giờ in ra.
- Giá trị cần sửa theo cụm mới: mapping trong `ch_finalize_xml.sh`; tên DB/bảng nếu khác
  `analytics.*`.
- Kiểm tra bộ file sau khi copy: `sha256sum -c SHA256SUMS`.
