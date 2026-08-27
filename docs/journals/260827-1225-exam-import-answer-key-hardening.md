---
title: "Siết đường đáp án của exam import: cổng PDF và khoá phủ một phần"
date: "2026-08-27T12:25:00+07:00"
status: shipped
severity: medium
component: exam-import
repository: Tedydev-web/classroomio
tags: [exam-import, answer-key, feature-flag, tdd, documentation]
---

# Siết đường đáp án của exam import: cổng PDF và khoá phủ một phần

## Context

Sau khi tính năng nạp đáp án từ file riêng đã lên production và chạy đúng trên
cặp tài liệu thật, phần Finalize của quy trình còn ba việc bị bỏ: đồng bộ plan,
đánh giá tác động tài liệu, và journal. Khi mở `docs/exam-import-markup.md` để
đánh giá tác động, tài liệu vẫn chỉ mô tả nhãn `Answer:` — không có bảng đáp án,
lưới số, danh sách mỗi dòng một đáp án, cũng không có file đáp án riêng, dù cả
năm dạng đều đã đọc được.

## What happened

Việc đọc tài liệu để cập nhật lại phát hiện hai lỗi trong chính phần đã ship.

**Cổng cờ PDF hở.** Đường nạp đề chính từ chối PDF khi `EXAM_IMPORT_PDF_ENABLED`
tắt. Đường nạp file đáp án dùng cùng `readPdfRuns` nhưng không kiểm cờ. Cờ đóng
một cửa và bỏ ngỏ cửa còn lại, khiến quy trình rollback PDF ghi trong
`docs/exam-import-rollout.md` không còn kín. Sửa bằng đúng guard của đường chính,
đặt ngay sau bước nhận dạng định dạng.

**Khoá phủ một phần vứt bỏ phần đã đọc được.** Giáo viên nhập 39/40 đáp án thì
mất cả 39, chỉ nhận thông báo rằng số lượng không khớp. Nay đường đáp án *có
đánh số* giữ lại những câu mà số của nó chỉ đúng vị trí; các câu còn thiếu vẫn
tự phát sinh finding blocking nên xuất bản vẫn bị chặn — quyết định "phủ một
phần thì chặn" được giữ nguyên, chỉ bỏ phần huỷ hoại công sức. Đường đáp án
*theo thứ tự* giữ nguyên kiểm tra số lượng chặt: không có số thì một danh sách
thiếu sẽ đẩy mọi đáp án sau khoảng trống sang sai câu.

## What nearly shipped wrong

Bản sửa đầu tiên của tôi định xoá thẳng lệnh `throw`. Nhưng chính lệnh đó là thứ
bảo đảm cho `answersByNumber.get(questionNumber)!` — bỏ nó đi thì `undefined`
lọt qua non-null assertion vào `answerPatch`, sinh patch dị dạng mà vẫn lưu
được. Cách đúng là lọc `covered` rồi map trên đó, không phải xoá kiểm tra.

Tôi cũng suýt để lại một câu sai trong tài liệu người dùng: đã viết rằng màn
review "nêu tên các câu còn thiếu đáp án thay vì chỉ báo con số" trước khi kiểm
chứng. Đọc mã cho thấy lúc đó nó vẫn chỉ báo con số. Câu đó là suy đoán mặc áo
quan sát, và tài liệu là nơi sai lệch kiểu này sống lâu nhất.

## Verification

- `applyExamImportAnswerKeyDocumentService` từ chối PDF khi cờ tắt — test đỏ
  trước, xanh sau.
- Khoá `1B` trên đề hai câu: `appliedCount` bằng 1, câu còn lại `answerKey` là
  `null`, và `validateExamImportDraft(...).publishable` bằng `false`.
- Khoá theo thứ tự thiếu số lượng vẫn ném `ANSWER_KEY_COUNT_MISMATCH`.
- `@cio/exam-import` 372 test, `pnpm test` 24/24 task, `pnpm typecheck` 14/14.

## Open

Token Cloudflare người dùng dán trong hội thoại vẫn chưa thu hồi, và production
vẫn đang chạy bằng nó.
