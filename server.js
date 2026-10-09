const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const bcrypt = require("bcryptjs");
const { Pool } = require("pg");
const path = require("path");

const app = express();
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false }
});
const PORT = process.env.PORT || 3000;

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(session({
  name: "rjisp.sid",
  secret: process.env.SESSION_SECRET || "replace-this-before-production",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 8 * 60 * 60 * 1000 }
}));

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS customers (
      id BIGSERIAL PRIMARY KEY,
      customer_code TEXT UNIQUE,
      full_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      address TEXT DEFAULT '',
      package_name TEXT DEFAULT '',
      monthly_fee NUMERIC(12,2) NOT NULL DEFAULT 0,
      expiry_date DATE,
      status TEXT NOT NULL DEFAULT 'active',
      notes TEXT DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS payments (
      id BIGSERIAL PRIMARY KEY,
      customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
      payment_method TEXT NOT NULL DEFAULT 'Cash',
      reference TEXT DEFAULT '',
      paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      notes TEXT DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS reminder_logs (
      id BIGSERIAL PRIMARY KEY,
      customer_id BIGINT REFERENCES customers(id) ON DELETE SET NULL,
      reminder_date DATE NOT NULL,
      status TEXT NOT NULL,
      detail TEXT DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(customer_id, reminder_date)
    );
  `);
}
const auth = (req,res,next) => req.session && req.session.loggedIn ? next() : res.status(401).json({error:"براہ کرم پہلے لاگ اِن کریں۔"});
const clean = v => String(v ?? "").trim();

app.get("/health", (_req,res)=>res.json({ok:true}));
app.get("/api/config", (_req,res)=>res.json({configured: Boolean(process.env.ADMIN_PASSWORD_HASH), whatsappConfigured: Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID)}));
app.post("/api/login", async (req,res)=>{
  try {
    const password = String(req.body.password || "");
    const hash = process.env.ADMIN_PASSWORD_HASH;
    if (!hash) return res.status(503).json({error:"ADMIN_PASSWORD_HASH ابھی ہوسٹنگ میں سیٹ نہیں ہوا۔ README_URDU.txt دیکھیں۔"});
    if (!await bcrypt.compare(password, hash)) return res.status(401).json({error:"پاس ورڈ درست نہیں۔"});
    req.session.loggedIn = true;
    res.json({ok:true});
  } catch(e) { res.status(500).json({error:"لاگ اِن میں مسئلہ پیش آیا۔"}); }
});
app.post("/api/logout", (req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get("/api/me", (req,res)=>res.json({loggedIn:!!(req.session && req.session.loggedIn)}));

app.get("/api/dashboard", auth, async (_req,res)=>{
  try {
    const [c,p,exp,bal] = await Promise.all([
      pool.query("SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status='active')::int AS active FROM customers"),
      pool.query("SELECT COALESCE(SUM(amount),0)::numeric AS collected FROM payments WHERE date_trunc('month',paid_at)=date_trunc('month',CURRENT_DATE::timestamp)"),
      pool.query("SELECT COUNT(*)::int AS count FROM customers WHERE status='active' AND expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 2"),
      pool.query("SELECT COALESCE(SUM(GREATEST(c.monthly_fee-COALESCE(p.total,0),0)),0)::numeric AS outstanding FROM customers c LEFT JOIN (SELECT customer_id,SUM(amount) total FROM payments WHERE date_trunc('month',paid_at)=date_trunc('month',CURRENT_DATE::timestamp) GROUP BY customer_id) p ON p.customer_id=c.id WHERE c.status='active'")
    ]);
    res.json({customers:c.rows[0], collectedThisMonth:p.rows[0].collected, expiring:exp.rows[0].count, outstanding:bal.rows[0].outstanding});
  } catch(e) { res.status(500).json({error:"ڈیش بورڈ لوڈ نہیں ہو سکا۔"}); }
});
app.get("/api/customers", auth, async (req,res)=>{
  try {
    const q = `%${clean(req.query.q)}%`;
    const r = await pool.query(`SELECT c.*, COALESCE(p.total_paid,0) AS total_paid FROM customers c LEFT JOIN (SELECT customer_id,SUM(amount) total_paid FROM payments WHERE date_trunc('month',paid_at)=date_trunc('month',CURRENT_DATE::timestamp) GROUP BY customer_id) p ON p.customer_id=c.id WHERE c.full_name ILIKE $1 OR c.phone ILIKE $1 OR COALESCE(c.customer_code,'') ILIKE $1 ORDER BY c.id DESC LIMIT 2000`,[q]);
    res.json(r.rows);
  } catch(e) { res.status(500).json({error:"کسٹمرز لوڈ نہیں ہو سکے۔"}); }
});
app.post("/api/customers", auth, async (req,res)=>{
  const b=req.body||{};
  if(!clean(b.full_name)||!clean(b.phone)) return res.status(400).json({error:"کسٹمر کا نام اور فون لازمی ہیں۔"});
  try {
    const r=await pool.query(`INSERT INTO customers(customer_code,full_name,phone,address,package_name,monthly_fee,expiry_date,status,notes)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [clean(b.customer_code)||null,clean(b.full_name),clean(b.phone),clean(b.address),clean(b.package_name),Number(b.monthly_fee)||0,b.expiry_date||null,clean(b.status)||"active",clean(b.notes)]);
    res.json(r.rows[0]);
  } catch(e) { res.status(400).json({error:e.code==="23505"?"یہ کسٹمر کوڈ پہلے سے موجود ہے۔":"کسٹمر محفوظ نہیں ہو سکا۔ کسٹمر کوڈ منفرد رکھیں۔"}); }
});
app.put("/api/customers/:id", auth, async (req,res)=>{
  const b=req.body||{};
  try {
    const r=await pool.query(`UPDATE customers SET customer_code=$1,full_name=$2,phone=$3,address=$4,package_name=$5,monthly_fee=$6,expiry_date=$7,status=$8,notes=$9 WHERE id=$10 RETURNING *`,
      [clean(b.customer_code)||null,clean(b.full_name),clean(b.phone),clean(b.address),clean(b.package_name),Number(b.monthly_fee)||0,b.expiry_date||null,clean(b.status)||"active",clean(b.notes),req.params.id]);
    if(!r.rowCount) return res.status(404).json({error:"کسٹمر نہیں ملا۔"});
    res.json(r.rows[0]);
  } catch(e) { res.status(400).json({error:"کسٹمر اپ ڈیٹ نہیں ہو سکا۔"}); }
});
app.delete("/api/customers/:id", auth, async (req,res)=>{
  try { await pool.query("DELETE FROM customers WHERE id=$1",[req.params.id]); res.json({ok:true}); }
  catch(e){res.status(500).json({error:"کسٹمر حذف نہیں ہو سکا۔"});}
});
app.get("/api/payments", auth, async (_req,res)=>{
  try { const r=await pool.query(`SELECT p.*,c.full_name,c.customer_code FROM payments p JOIN customers c ON c.id=p.customer_id ORDER BY p.paid_at DESC LIMIT 1000`); res.json(r.rows); }
  catch(e){res.status(500).json({error:"ادائیگیاں لوڈ نہیں ہو سکیں۔"});}
});
app.post("/api/payments", auth, async (req,res)=>{
  const b=req.body||{}, amount=Number(b.amount);
  if(!b.customer_id || !(amount>0)) return res.status(400).json({error:"کسٹمر اور درست رقم منتخب کریں۔"});
  try { const r=await pool.query("INSERT INTO payments(customer_id,amount,payment_method,reference,notes) VALUES($1,$2,$3,$4,$5) RETURNING *",[b.customer_id,amount,clean(b.payment_method)||"Cash",clean(b.reference),clean(b.notes)]); res.json(r.rows[0]); }
  catch(e){res.status(400).json({error:"ادائیگی محفوظ نہیں ہو سکی۔"});}
});
app.get("/api/export/customers.csv", auth, async (_req,res)=>{
  const r=await pool.query("SELECT customer_code,full_name,phone,address,package_name,monthly_fee,expiry_date,status,notes FROM customers ORDER BY id");
  const esc=x=>`"${String(x??"").replace(/"/g,'""')}"`;
  const lines=[["Customer Code","Name","Phone","Address","Package","Monthly Fee","Expiry Date","Status","Notes"],...r.rows.map(x=>[x.customer_code,x.full_name,x.phone,x.address,x.package_name,x.monthly_fee,x.expiry_date,x.status,x.notes])].map(row=>row.map(esc).join(","));
  res.setHeader("Content-Type","text/csv; charset=utf-8");res.setHeader("Content-Disposition",'attachment; filename="isp-customers.csv"');res.send("\\uFEFF"+lines.join("\\r\\n"));
});

// Daily reminder runner. Requires official WhatsApp Cloud API credentials and an approved template.
// For production, use a durable scheduled job/worker; this endpoint is protected by a secret.
app.post("/internal/run-reminders", async (req,res)=>{
  if(!process.env.JOB_SECRET || req.get("x-job-secret")!==process.env.JOB_SECRET) return res.status(403).json({error:"Forbidden"});
  if(!process.env.WHATSAPP_TOKEN || !process.env.WHATSAPP_PHONE_NUMBER_ID || !process.env.WHATSAPP_TEMPLATE_NAME) return res.status(503).json({error:"WhatsApp API settings are missing"});
  try {
    const customers=await pool.query(`SELECT id,full_name,phone,package_name,expiry_date FROM customers WHERE status='active' AND expiry_date=CURRENT_DATE+2`);
    const results=[];
    for(const c of customers.rows){
      const already=await pool.query("SELECT 1 FROM reminder_logs WHERE customer_id=$1 AND reminder_date=CURRENT_DATE",[c.id]);
      if(already.rowCount) continue;
      const phone=String(c.phone).replace(/[^0-9]/g,"");
      const body={messaging_product:"whatsapp",to:phone,type:"template",template:{name:process.env.WHATSAPP_TEMPLATE_NAME,language:{code:process.env.WHATSAPP_LANGUAGE_CODE||"en_US"},components:[{type:"body",parameters:[{type:"text",text:c.full_name},{type:"text",text:c.package_name||"Internet package"},{type:"text",text:String(c.expiry_date).slice(0,10)}]}]}};
      const response=await fetch(`https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,{method:"POST",headers:{Authorization:`Bearer ${process.env.WHATSAPP_TOKEN}`,"Content-Type":"application/json"},body:JSON.stringify(body)});
      const data=await response.json();
      const status=response.ok?"sent":"failed";
      await pool.query("INSERT INTO reminder_logs(customer_id,reminder_date,status,detail) VALUES($1,CURRENT_DATE,$2,$3) ON CONFLICT(customer_id,reminder_date) DO NOTHING",[c.id,status,JSON.stringify(data).slice(0,1500)]);
      results.push({customer_id:c.id,status});
    }
    res.json({processed:results.length,results});
  } catch(e){res.status(500).json({error:"Reminder job failed"});}
});
app.get("/api/reminders/status",auth,async (_req,res)=>{
  try {const r=await pool.query("SELECT status,COUNT(*)::int AS count FROM reminder_logs GROUP BY status");res.json(r.rows);}
  catch(e){res.status(500).json({error:"Reminder status unavailable"});}
});

app.use(express.static(path.join(__dirname,"public")));
app.get("*",(_req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
init().then(()=>app.listen(PORT,"0.0.0.0",()=>console.log("RJ ISP Panel listening on "+PORT))).catch(e=>{console.error("Database initialization failed:",e.message);process.exit(1);});
