# ให้ Claude ทดสอบในเบราว์เซอร์ได้จริง — ต้องตั้งอะไรบ้าง

ตอนนี้ Claude ทดสอบได้แค่ 3 ระดับ:

| ระดับ                        | ทำได้ | ตัวอย่างในรอบที่ผ่านมา                                       |
| ---------------------------- | ----- | ------------------------------------------------------------ |
| Logic ล้วน                   | ✅    | ตารางผ่อน, เส้นทาง Maps, error codes, SSRF guard ของ webhook |
| ฐานข้อมูลจริง                | ✅    | ลบ user แล้ว cascade ถูกต้อง, ที่นั่ง Family, trigram search |
| **กดใช้งานจริงผ่านหน้าเว็บ** | ❌    | export ข้อมูล, สร้างกิจวัตร, flow งานศพ                      |

ที่ติดคือระดับที่ 3 เท่านั้น และติดด้วยเหตุผลเดียว: **ไม่มีทางล็อกอิน**

---

## สาเหตุ

1. `.env` ในเครื่องที่ Claude ทำงานเป็นค่า placeholder (`placeholder.supabase.co`) — dev server รันได้แต่ไม่มีข้อมูล
2. เว็บ production ถูก network policy ของ environment บล็อก (403 ที่ CONNECT `lavieos.netlify.app`)
3. ต่อให้เปิดเน็ตให้ ก็ยังต้องมีบัญชีสำหรับล็อกอิน

---

## ทางเลือกที่ 1 — Supabase โปรเจกต์ทดสอบแยก (แนะนำ)

ปลอดภัยที่สุด เพราะ Claude ไม่แตะข้อมูลจริงเลย

1. สร้างโปรเจกต์ Supabase ใหม่ (free tier พอ) ชื่อเช่น `lifeos-test`
2. `supabase link --project-ref <ref ของโปรเจกต์ทดสอบ>` แล้ว `supabase db push` เพื่อสร้าง schema ให้เหมือน production
3. สร้างผู้ใช้ทดสอบ 2 คนใน Authentication → Users (เช่น `test-owner@example.com`, `test-member@example.com`) ตั้งรหัสผ่านไว้
4. ให้ `test-owner` เป็น admin: รันใน SQL Editor
   ```sql
   insert into public.user_roles (user_id, role)
   select id, 'admin' from auth.users where email = 'test-owner@example.com';
   ```
5. ส่งค่าเหล่านี้มาให้ Claude ใส่ใน `.env` ของ container:
   - `VITE_SUPABASE_URL` / `SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_PUBLISHABLE_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - อีเมล + รหัสผ่านของบัญชีทดสอบ

**ข้อสำคัญ:** นี่คือ key ของโปรเจกต์ทดสอบ ไม่ใช่ production — ถ้าหลุดก็เสียแค่ข้อมูลทดสอบ
ห้ามส่ง `SUPABASE_SERVICE_ROLE_KEY` ของ production มาทางแชทเด็ดขาด

ถ้าจะให้ทดสอบส่วน AI ด้วย ใส่ `GOOGLE_GENERATIVE_AI_API_KEY` หรือ `ANTHROPIC_API_KEY`
(ควรเป็น key ที่จำกัดวงเงินไว้ เพราะการทดสอบจะเรียก AI จริงและมีค่าใช้จ่ายจริง)

## ทางเลือกที่ 2 — บัญชีทดสอบบน production

เร็วกว่า แต่ข้อมูลทดสอบจะปนกับของจริง

1. สมัครบัญชีใหม่บนเว็บจริง เช่น `qa@yourdomain.com` (อย่าใช้บัญชีคุณเอง)
2. ถ้าต้องทดสอบหน้า admin ให้ใส่ role admin ให้บัญชีนั้นด้วย SQL ข้างบน
3. เปิด network policy ให้ container เข้าถึง `lavieos.netlify.app` ได้
   (เมนู cloud environment บนแถบชื่อ session → Edit → Network access → เพิ่ม domain หรือเลือกระดับที่กว้างขึ้น)
4. ส่งอีเมล + รหัสผ่านของบัญชีทดสอบมา

**ข้อควรระวัง:** Claude จะสร้าง/ลบข้อมูลจริงในระบบ เช่น สร้างกิจวัตร สร้างแผนงานศพ กดแจ้งชำระเงิน
ควรลบข้อมูลทดสอบทิ้งหลังเสร็จ และอย่าให้บัญชีทดสอบอยู่ในครอบครัวเดียวกับบัญชีจริง

## ทางเลือกที่ 3 — Supabase ในเครื่อง container (ไม่แนะนำ)

`supabase start` ต้องใช้ Docker ซึ่ง container นี้ไม่มี จึงทำไม่ได้ในสภาพแวดล้อมปัจจุบัน

---

## เมื่อตั้งเสร็จแล้ว Claude จะทำอะไรได้เพิ่ม

- กดผ่าน Playwright ทุกหน้าในฐานะผู้ใช้จริง: กรอกฟอร์ม กดปุ่ม อ่านผลลัพธ์ ถ่ายภาพหน้าจอให้ดู
- ทดสอบ flow ยาว ๆ ได้ครบ เช่น เลือกแพ็กงานศพ → ยืนยันฝั่ง admin → เลือกวิธีดำเนินการ → ผ่อน → อัปโหลดหลักฐาน
- เปลี่ยนสถานะ 🧪 เป็น ✅ ใน `FEATURE-MAP-AND-BACKLOG.md` ได้ด้วยหลักฐานจริง ไม่ใช่การอนุมาน
- จับบั๊กประเภทที่ tsc/eslint จับไม่ได้: ปุ่มกดแล้วไม่มีอะไรเกิด, ข้อความไม่ขึ้น, layout เพี้ยนบนมือถือ
