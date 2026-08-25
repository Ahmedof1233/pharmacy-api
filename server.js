require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json()); // مهم جداً لاستقبال البيانات بصيغة JSON

const PORT = process.env.PORT || 3000;

const pool = mysql.createPool({
    uri: process.env.DATABASE_URL,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

async function initializeDatabase() {
    try {
        const connection = await pool.getConnection();
        console.log("✅ تم الاتصال بقاعدة بيانات TiDB بنجاح!");
        
        await connection.query(`CREATE TABLE IF NOT EXISTS patients (id INT AUTO_INCREMENT PRIMARY KEY, qr_uuid VARCHAR(36) UNIQUE NOT NULL, full_name VARCHAR(255) NOT NULL, phone_number VARCHAR(20), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await connection.query(`CREATE TABLE IF NOT EXISTS medications (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255) NOT NULL, image_url VARCHAR(255), price DECIMAL(10, 2))`);
        await connection.query(`CREATE TABLE IF NOT EXISTS patient_medications (id INT AUTO_INCREMENT PRIMARY KEY, patient_id INT, medication_id INT, dosage VARCHAR(255), quantity_per_month INT DEFAULT 1, FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE, FOREIGN KEY (medication_id) REFERENCES medications(id) ON DELETE CASCADE)`);
        
        console.log("✅ تم التأكد من وجود جميع الجداول (Schema Ready)!");
        connection.release();
    } catch (error) {
        console.error("❌ حدث خطأ:", error.message);
    }
}
initializeDatabase();


// ==========================================
// مسارات الـ API (Endpoints)
// ==========================================

// 1. إضافة مريض جديد (للوحة تحكم الصيدلي)
// 1. إضافة مريض جديد (للوحة تحكم الصيدلي)
app.post('/api/patients', async (req, res) => {
    try {
        const { qr_uuid, full_name, phone_number, medications } = req.body;
        
        // 1. حفظ بيانات المريض الأساسية
        const [patientResult] = await pool.execute(
            'INSERT INTO patients (qr_uuid, full_name, phone_number) VALUES (?, ?, ?)',
            [qr_uuid, full_name, phone_number]
        );
        const patientId = patientResult.insertId;

        // 2. إذا تم تحديد أدوية، نقوم بربطها بالمريض
        if (medications && medications.length > 0) {
            for (const med of medications) {
                // التأكد أولاً من وجود الدواء في جدول الأدوية (وإضافته إن لم يكن موجوداً)
                const [existingMed] = await pool.execute('SELECT id FROM medications WHERE name = ?', [med.name]);
                let medId;
                
                if (existingMed.length > 0) {
                    medId = existingMed[0].id;
                } else {
                    const [newMed] = await pool.execute(
                        'INSERT INTO medications (name, price) VALUES (?, ?)',
                        [med.name, med.price]
                    );
                    medId = newMed.insertId;
                }

                // ربط الدواء بالمريض بالجرعة المحددة
                await pool.execute(
                    'INSERT INTO patient_medications (patient_id, medication_id, dosage, quantity_per_month) VALUES (?, ?, ?, ?)',
                    [patientId, medId, med.dosage, 1]
                );
            }
        }
        
        res.status(201).json({ success: true, message: 'تم إضافة المريض وأدويته بنجاح' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'حدث خطأ أثناء إضافة المريض' });
    }
});


// 2. جلب بيانات المريض باستخدام الـ QR Code (لواجهة المريض)
app.get('/api/patient/:qr_uuid', async (req, res) => {
    try {
        const { qr_uuid } = req.params;

        // البحث عن المريض
        const [patientRows] = await pool.execute(
            'SELECT id, full_name, phone_number FROM patients WHERE qr_uuid = ?',
            [qr_uuid]
        );

        if (patientRows.length === 0) {
            return res.status(404).json({ success: false, message: 'بيانات المريض غير موجودة.' });
        }

        const patient = patientRows[0];

        // جلب أدوية هذا المريض
        const [medications] = await pool.execute(`
            SELECT m.id, m.name, m.price, pm.dosage, pm.quantity_per_month
            FROM patient_medications pm
            JOIN medications m ON pm.medication_id = m.id
            WHERE pm.patient_id = ?
        `, [patient.id]);

        res.status(200).json({
            success: true,
            data: {
                patientInfo: { name: patient.full_name, phone: patient.phone_number },
                medications: medications
            }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'حدث خطأ في الخادم.' });
    }
});

// مسار تجريبي للتأكد من عمل السيرفر
app.get('/', (req, res) => {
    res.send('Pharmacy API is running perfectly!');
});

// تشغيل السيرفر محلياً فقط، وتصديره لـ Vercel عند الرفع
if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => {
        console.log(`🚀 السيرفر يعمل الآن على الرابط: http://localhost:${PORT}`);
    });
}
module.exports = app;