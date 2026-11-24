# Kịch bản kiểm thử toàn luồng WF-04 Ticket Management

Kịch bản dành cho QA và người demo trên Core PoC local. Thực hiện ca chính trên một Ticket dùng một lần, rồi chạy các ca ngoại lệ tương ứng. Kết quả trong tài liệu là **kỳ vọng**. Điền kết quả sau mỗi lần chạy.

## 1. Chuẩn bị

| Cần chuẩn bị | Cách kiểm tra |
| --- | --- |
| Web và Core | Mở `http://localhost:3000/login`, `http://localhost:8082/health/ready` và `http://localhost:8082/api/docs`. Readiness phải trả 200 và Swagger có các route Priority, Eligible Users, Archive/Restore và Evidence. |
| Phiên IAM | Operator O là người tạo và Business Owner ban đầu. Technician T là Assignee. IT Admin A dùng để kiểm tra từ chối nghiệp vụ Ticket và đọc Audit nếu có quyền. Mở ba profile trình duyệt riêng. Mỗi tài khoản xác nhận danh tính qua `GET /api/v1/auth/me`. Dùng phiên hợp lệ mới cho mỗi lần chạy. |
| Ticket và Asset | Dùng kịch bản đã duyệt cho một Ticket mới, đặt tiêu đề duy nhất bằng chữ và số, ví dụ `WF04 20261123 Run01`. Dùng hai Asset thử đã duyệt cho ca liên kết. Nếu thiếu Asset, chạy nhánh Ticket-only với danh sách link rỗng và đánh dấu ca Asset là BLOCKED. |
| Evidence | Chuẩn bị một ảnh PNG/JPEG/WebP thật và một PDF nhỏ, mỗi file tối đa 8 MiB. Ghi tên, kích thước và SHA-256 file gốc. Danh sách Evidence của Ticket mới phải báo `upload_available: true` sau khi Core đã mount kho riêng. |
| Phạm vi | Ghi lại image Core, URL, thời gian, trình duyệt và người chạy. Giữ Ticket 3, Ticket 11 và fixture lịch sử ngoài mọi thao tác ghi. Chỉ thực hiện qua Core. Chạy fault injection và thử tài khoản lỗi trên môi trường cô lập đã duyệt. |

Mọi đường dẫn Ticket dưới đây có tiền tố `/api/v1/tickets`. `{id}` là ID số từ phản hồi tạo Ticket, dùng xuyên suốt. Ghi cả `ticket_id` và `number`, cùng ID Article/Evidence khi có. Với API tạo hoặc sửa có idempotency, mỗi thao tác mới dùng một `Idempotency-Key` riêng. Khi thử lại yêu cầu cũ, giữ đúng actor, key và payload. Che bearer token, cookie và Evidence grant trong ảnh, HAR và log.

## 2. Ca chính Web → Core → Zammad

| Bước | Người chạy và thao tác | API đối chiếu | Kết quả mong đợi |
| --- | --- | --- | --- |
| 01 | O vào **Ticket Management**. Mở **Create Ticket**, tải danh mục Priority và tìm O, T theo tên/username trong hai bộ chọn. | `GET /metadata/priorities`, `GET /eligible-users?search=…&page_size=10` | 200. PoC hiện có **Low**, **Normal**, **High** với màu tương ứng. Dùng ID trả về từ catalog. Tên được tìm từ IAM, danh sách chỉ hiện người đang hoạt động và đủ điều kiện trong group. Nếu có `next_cursor`, dùng nó để tải trang tiếp. |
| 02 | O nhập tiêu đề, mô tả, chọn **Normal**, Business Owner O, Assignee T và Asset A nếu đã có. Kiểm tra **Ticket Preview** rồi bấm tạo. | `POST /` | 201. Preview hiện đúng tên và Priority. Request gửi ID Priority số và hai Core UUID. Phản hồi trả ID và số Ticket, trạng thái **NEW**. Ghi lại `{id}`. |
| 03 | O tìm Ticket theo tiêu đề, lọc trạng thái và Priority, thử **Load more** khi có trang kế. Mở Quick View và chi tiết. T mở **My Tickets** và cùng Ticket. | `GET /`, `GET /{id}` | 200. O và T thấy cùng ID, số, tiêu đề, trạng thái. Bộ lọc gửi ID Priority từ catalog, cursor do Core cấp được giữ nguyên. Nếu search Zammad chưa cập nhật ngay, kiểm tra chi tiết theo ID trước rồi tải lại danh sách. |
| 04 | O mở **Edit information**, sửa tiêu đề và Priority sang **High**. Sau đó mở **Change responsibilities**, đổi Assignee từ T sang O mà không gửi Business Owner. T thử tải lại chi tiết. O gán lại T để tiếp tục. | `PATCH /{id}`, `PATCH /{id}/responsibilities`, `GET /{id}` | Các cập nhật hợp lệ trả 200. Cùng ID. Business Owner giữ nguyên khi đổi Assignee. T nhận 404 trong thời gian mất phân công và nhận lại 200 khi được gán lại. |
| 05 | O mở **Edit Asset links**, lưu Asset A và B. O và T đọc phần Business Links. | `PATCH /{id}/links`, `GET /{id}/links` | 200. Core trả đúng các Asset UUID. Incident và Maintenance giữ nguyên. Nếu chạy Ticket-only, đọc được danh sách Asset rỗng và ghi riêng nhánh Asset là BLOCKED. |
| 06 | T mở **Update progress** theo thứ tự **NEW → OPEN → PENDING → OPEN**. Khi chuyển PENDING, chọn thời điểm tương lai bằng UI. Refresh giữa các bước. | 3 lần `POST /{id}/status`, `GET /{id}` | Mỗi bước 200. PENDING gửi `pending_until` dạng ISO có múi giờ. Readback giữ cùng ID và hiển thị đúng tiến độ. |
| 07 | T chọn **Add internal note**, nhập nội dung nhận diện của lần chạy. O đọc Timeline. Lặp cùng request một lần qua API để kiểm tra replay. | `POST /{id}/articles`, `GET /{id}/articles` | 201 khi ghi, 200 khi đọc. Article là internal, hiển thị plain text. Replay trả cùng `article_id`, chỉ có một bản ghi nội dung đó. |
| 08 | T tải lên một ảnh và PDF. O refresh gallery, xem ảnh inline và tải PDF. So SHA-256 PDF tải về với file gốc. | `POST /{id}/evidence/uploads` → `PUT /{id}/evidence/uploads` → `POST /{id}/evidence/finalize`, rồi `GET /{id}/evidence` và `POST /{id}/evidence/{evidence_id}/access` → `POST /{id}/evidence/{evidence_id}/content` | Grant upload 201, chuyển bytes 200, finalize 201. List và phát nội dung trả 200. `PUT` dùng `application/octet-stream` và `X-Evidence-Grant`. PDF tải dạng attachment, ảnh preview đúng file. Replay finalize cùng key và grant trả cùng Evidence ID. |
| 09 | O, vẫn là Business Owner, chọn **Close Ticket** và ghi kết quả xử lý. T refresh **My Tickets**. | `POST /{id}/close`, `GET /{id}` | 200, **OPEN → CLOSED**. ID, số Ticket, Articles, Evidence và Asset links giữ nguyên. |
| 10 | O chọn **Reopen Ticket**, nhập lý do. | `POST /{id}/reopen`, `GET /{id}` | 200, **CLOSED → OPEN**, cùng Ticket và lịch sử. |
| 11 | O chọn **Move to Trash**, kiểm tra tiêu đề/số Ticket trên hộp thoại, nhập lý do và xác nhận. Kiểm tra **Active workspace**, **Archived Tickets** và Evidence từ Archive. | `POST /{id}/archive`, `GET /`, `GET /archived`, `GET /{id}`, `GET /{id}/evidence` | Archive 200, danh sách Active loại Ticket, Archive trả trạng thái trước đó và lý do. Detail thông thường trả 404. Operator có quyền vẫn đọc và tải được Evidence qua Archive. Archive không đổi trạng thái Ticket trên Zammad. |
| 12 | O chọn **Restore Ticket**, nhập lý do. Refresh Active và Archive, mở lại Ticket với O và Assignee T. So sánh file đã tải trước và sau. | `POST /{id}/restore`, `GET /`, `GET /archived` và các API đọc chi tiết | Restore 200. Cùng ID và số Ticket, trở lại Active ở **OPEN**. Archive không còn trả Ticket này. Articles, Asset links, Evidence ID và hash file giữ nguyên. T truy cập theo trách nhiệm hiện tại. |
| 13 | A, nếu có quyền Audit, tra lịch sử Ticket qua Core. Nếu có người vận hành được quyền, đối chiếu Zammad theo cùng ID ở chế độ chỉ đọc. | `GET /api/v1/audit/events` với `resource_type=ticket` và `resource_id` là JSON `[instanceKey, id]` đã mã hóa URL | Audit ghi actor, hành động và thời điểm. Đối chiếu actor của Article/Evidence, lý do Archive/Restore và xác nhận replay không tạo Audit trùng. Zammad còn cùng Ticket và Articles. A vẫn bị từ chối các API nghiệp vụ Ticket. |

**Mốc đối chiếu nhanh:** `NEW → OPEN → PENDING → OPEN → CLOSED → OPEN → archived (Core) → OPEN`. Hai bước cuối giữ nguyên lifecycle Zammad.

## 3. Ca ngoại lệ và an toàn

| Ca | Thao tác trên fixture mới hoặc môi trường cô lập | Kết quả mong đợi |
| --- | --- | --- |
| N01 · Authentication và quyền | Gọi API chưa đăng nhập. Dùng T thử tạo Ticket, sửa Priority, tự gán, đổi Owner, đổi links, đóng, mở lại, Archive và Restore. Dùng A thử gọi các API Ticket, gồm cả Eligible Users. | 401 khi chưa đăng nhập. Vai trò thiếu quyền nhận 403. Các yêu cầu bị từ chối giữ nguyên canonical state, trách nhiệm, links và Articles. |
| N02 · Chỉ Owner được đóng | Dùng Operator thứ hai đã duyệt hoặc trên Ticket thử tạm chuyển Owner sang T trong khi O vẫn có `ticket:close`. O thử đóng. Sau đó khôi phục Owner O bằng thao tác được duyệt để tiếp tục. | O không còn là current Owner nên nhận 403 dù có permission. Ticket vẫn OPEN. T thiếu quyền close cũng nhận 403. |
| N03 · Chuyển trạng thái không hợp lệ | Gửi `CLOSED` qua API progress, thử lặp OPEN khi đang OPEN, thử PENDING với hạn đã qua và thử reopen bằng T trên Ticket CLOSED. | 400 cho state ngoài DTO hoặc hạn PENDING đã qua, 409 khi chuyển không hợp lệ với trạng thái hiện tại, 403 cho T reopen. Mỗi lần đọc lại cùng ID xác nhận trạng thái không đổi. |
| N04 · Archive và Evidence | Khi Ticket archived, thử upload/append/đổi trách nhiệm bằng O. T thử detail và Evidence list. Sau restore, thử lại bằng Assignee cũ đã bị đổi khỏi Ticket. | Mutations thông thường trên Ticket archived bị từ chối. Detail thông thường trả 404, Evidence list của T trên archived trả 403. Restore không cấp lại quyền cho Assignee cũ. |
| N05 · File và grant | Dùng MIME không hỗ trợ, file trên 8 MiB, byte sai định dạng, grant của Ticket/actor khác, grant hết hạn và PDF yêu cầu inline. | API từ chối theo giai đoạn. Byte sai định dạng được từ chối 415, vượt giới hạn body được từ chối 413, PDF inline bị từ chối. List không có metadata mới cho upload bị từ chối. Nếu test upload bị gián đoạn, chỉ thử lại đúng grant khi còn hạn và giữ key finalize. |
| N06 · Identity và links | Trong bộ fixture đã duyệt, thử Assignee chưa mapping, sai group hoặc inactive. Thử Asset không hợp lệ/không được phép. | Người không đủ điều kiện không xuất hiện trong picker. Core từ chối khi gửi UUID trực tiếp. Link và trách nhiệm cũ giữ nguyên. |
| N07 · Retry, recovery và tranh chấp | Dùng harness cô lập để giả lập mất phản hồi sau upstream create/append, lỗi ghi Audit và hai thao tác đồng thời trên cùng Ticket. Kiểm tra xung đột khi dùng lại key với payload khác. | Không có Ticket/Article trùng hay báo thành công sai. Outcome chưa rõ có thể trả 409/503. Cùng key chỉ khôi phục khi có bằng chứng chính xác. Payload khác cùng key bị từ chối. Không dùng key mới để xử lý kết quả chưa rõ. |
| N08 · Lỗi dependency UI | Trên mock/contract harness, ngắt tạm Priority Catalog và Eligible Users, rồi cho chúng hoạt động lại và bấm Retry. | Ticket đang xem vẫn đọc được. Priority chưa biết hiển thị trung tính. Form chặn tạo khi thiếu lựa chọn bắt buộc và tải lại được dữ liệu sau Retry. |

## 4. Nhánh tích hợp và demo

- **DS-04a / TC-WF04-18:** Chạy bước 01–09 với **Operator trên Web** và **Technician trên Mobile thật** ở bước 03, 06, 07. Kiểm tra cùng canonical ID và Article hiển thị lại trên Web. Nếu chưa có Mobile hoặc seeded staging, ghi **BLOCKED** cho DS-04a, dù toàn luồng Web local chạy qua.
- **DS-04b:** Ghép N02 với N07. Thu bằng chứng từ chối non-Owner và bằng chứng kết quả upstream chưa chắc chắn không sinh Ticket/Article trùng.
- **UC-64 / TC-WF04-02:** Reviewed Incident Draft vẫn phụ thuộc hợp đồng Incident. Ca fail-closed gọi `POST /from-reviewed-draft` với `draft_id`, `revision`, `priority_id` và hai UUID hợp lệ, rồi kiểm tra 503 khi provider vắng mặt. Khi có provider, chạy thêm Confirmed Incident, draft đúng/sai revision, xác nhận trùng, đối chiếu evidence/provenance và lifecycle Incident độc lập.
- **UC-72/73 / TC-WF04-09, 10:** Nhánh Asset chạy ở bước 05. Tích hợp Incident/Maintenance thuộc ca riêng khi có public contract và fixture đã duyệt. Kiểm tra link hợp lệ, sai phạm vi và việc hoàn tất Maintenance giữ nguyên trạng thái Ticket. Nếu vai trò MR nằm trong nghiệm thu, ghi bằng chứng trên client MR thực tế.
- **Các ID còn lại:** Bước 02–07 bao phủ 01, 04, 05 và 13–15. Bước 09–10 bao phủ 16–17. N01, N02, N03, N06, N07 lần lượt tham chiếu 03/06, 07, 08/19, 20, 11/12/21/22. Archive, Evidence và catalog là kiểm thử mở rộng, không cộng thêm vào 22 ID của ma trận gốc.

## 5. Ghi kết quả

| Run ID / môi trường / image | Case, bước và actor | HTTP / trạng thái / ID | Kết quả | Bằng chứng |
| --- | --- | --- | --- | --- |
| … | … | … | PASS / FAIL / BLOCKED / NOT RUN | Ảnh UI, request ID, readback, Audit hoặc SHA-256 |

Chỉ ghi **PASS Web E2E** khi thực hiện bằng trình duyệt, đăng nhập hợp lệ và đối chiếu qua Core/Zammad thật. Tách riêng kết quả browser mock, HTTP backend, Zammad thật và Web/Mobile/MR. Đối với nghiệm thu BM04, tổng hợp theo 22 ID gốc và các lớp kiểm thử bắt buộc trong ma trận.

- [Ma trận 22 ca và tiêu chí BM04](flow04-test-matrix.md)
- [OpenAPI Ticket](../../../api/v1/ticket.yaml)
- [Hướng dẫn API](../integration/flow04-ticket-api-guide.md)
- [Archive, Evidence, Priority và Eligible Users](../integration/flow04-archive-evidence-priority-review.md)
- [Điều kiện từ Incident và Maintenance](../integration/flow04-owning-module-handoff.md)
