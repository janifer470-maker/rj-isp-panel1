RJ NETWORKS ISP CLOUD STARTER — اردو گائیڈ
============================================

یہ ایک قابلِ توسیع starter ہے: Admin login، customer records، package/expiry، payments، dashboard، CSV export، receipt print/PDF، اور WhatsApp Cloud API reminder endpoint شامل ہیں۔ اسے production میں استعمال کرنے سے پہلے نیچے کے لازمی اقدامات مکمل کریں۔

اہم حدود:
- یہ ZIP اکیلے آپ کی ویب سائٹ کو انٹرنیٹ پر شائع نہیں کرتا۔ Render پر deploy کرنا ہوگا۔
- WhatsApp خودکار ریمائنڈرز ابھی تک نہیں چلیں گے جب تک آفیشل WhatsApp Cloud API، approved message template، credentials اور روزانہ scheduler configure نہ ہوں۔
- عام WhatsApp اکاؤنٹ کے ساتھ خودکار bulk messages بھیجنے کے لیے unofficial tools استعمال نہ کریں۔
- یہ مالیاتی gateway نہیں؛ صرف ادائیگی کا ریکارڈ اور رسید بناتا ہے۔
- 2,000 customer records ڈیٹابیس میں رکھے جا سکتے ہیں، مگر کارکردگی اور plan limits اپنے ہوسٹنگ پلان پر آزمائیں۔
- Free database plan کی مدت/limits بدل سکتی ہیں؛ business data کے لیے paid persistent database اور backups تجویز کیے جاتے ہیں۔

A. Render پر ویب ایپ اور database:
1. ZIP کو extract کریں۔
2. GitHub account بنائیں، اس فولڈر کی فائلیں نئی private repository میں upload کریں۔
3. https://render.com پر account بنائیں اور GitHub connect کریں۔
4. Render Dashboard میں New > Blueprint منتخب کریں، repository منتخب کریں، render.yaml کو review کریں اور deploy کریں۔
5. Database اور Web Service کی status دیکھیں۔ Deployment کے بعد Render آپ کو https://...onrender.com URL دے گا۔
6. اگر Free database ختم ہونے/غیر فعال ہونے کی مدت یا storage کی حد آئے تو production کے لیے مناسب paid plan منتخب کریں۔

B. Admin password hash بنانا:
اس پروجیکٹ کے package.json کے ساتھ terminal میں:
  npm install
  node -e "const b=require('bcryptjs'); console.log(b.hashSync('YOUR-STRONG-UNIQUE-PASSWORD',12))"
YOUR-STRONG-UNIQUE-PASSWORD کی جگہ اپنا مضبوط، منفرد پاس ورڈ دیں۔ اس پاس ورڈ کو کسی کو نہ بھیجیں۔
Render > Web Service > Environment میں ADMIN_PASSWORD_HASH نام کی variable بنائیں اور generated hash value رکھیں۔ SESSION_SECRET بھی لمبا random secret ہونا چاہیے (Render کی generated value استعمال کریں)۔ Save/Deploy کریں۔
JOB_SECRET کے نام سے بھی ایک لمبا random secret set کریں، پھر اسی secret کو scheduler کے محفوظ header میں استعمال کریں۔

C. WhatsApp setup (اختیاری، الگ مرحلہ):
1. https://developers.facebook.com/ پر Meta developer account اور WhatsApp Business Platform / Cloud API configure کریں۔
2. کاروباری نمبر، payment/verification requirements اور approved template مکمل کریں۔
3. Template name، language code، WHATSAPP_TOKEN اور WHATSAPP_PHONE_NUMBER_ID کو Render Environment Variables میں رکھیں۔ Token کو عوامی جگہ یا source code میں نہ لکھیں۔
4. اس starter کا default template isp_expiry_reminder ہے اور اس میں تین body parameters متوقع ہیں: customer name, package name, expiry date۔ Meta میں اسی structure کا template منظور کرائیں یا code/template کو مطابق کریں۔
5. Render یا کسی محفوظ scheduler میں روزانہ 9 بجے کے لیے POST request configure کریں:
   URL: https://YOUR-SERVICE.onrender.com/internal/run-reminders
   Header: x-job-secret: YOUR_JOB_SECRET
   Content-Type: application/json
   Body: {}
6. پہلے test customer اور Meta test number پر آزما کر reminder_logs کی رپورٹ دیکھیں۔ Customer کی واضح اجازت، opt-in اور applicable WhatsApp policy/template rules کی پابندی ضروری ہے۔
7. Scheduler کا free plan/availability مختلف ہو سکتا ہے۔ اگر scheduler دستیاب نہ ہو تو paid cron service یا اپنے server پر secure cron استعمال کریں۔

D. روزمرہ:
- Admin login URL: آپ کا Render URL
- Customers > نیا کسٹمر
- ادائیگی درج کریں > رسید پرنٹ / Save as PDF
- کسٹمرز > CSV رپورٹ
- ہر روز/ہفتے database backup کی تصدیق کریں۔
- عوامی کمپیوٹر پر لاگ اِن نہ رہیں اور پاس ورڈ کسی کے ساتھ share نہ کریں۔

E. سیکیورٹی:
- HTTPS کے باوجود strong password، private repository، least-privilege access، backups اور prompt security updates ضروری ہیں۔
- کسٹمر کے payment PIN، OTP یا bank password کبھی محفوظ نہ کریں۔
- production میں استعمال سے پہلے test data پر مکمل QA کریں؛ قانونی، tax اور privacy obligations اپنی جگہ کے مطابق چیک کریں۔
