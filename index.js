require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');

const app = express();
// السماح لجميع الروابط بالاتصال (لتخطي أي مشكلة CORS)
app.use(cors({ origin: '*' }));
app.use(express.json());

const PORT = process.env.PORT || 3000;

// إعداد الاتصال بقاعدة البيانات مع تفعيل الـ SSL الإلزامي لـ TiDB Cloud
const pool = mysql.createPool({
    uri: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: true
    },
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

async function initializeDatabase() {
    try {
        const connection = await pool.getConnection();
        await connection.query(`CREATE TABLE IF NOT EXISTS patients (id INT AUTO_INCREMENT PRIMARY KEY, qr_uuid VARCHAR(36) UNIQUE NOT NULL, full_name VARCHAR(255) NOT NULL, phone_number VARCHAR(20), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await connection.query(`CREATE TABLE IF NOT EXISTS medications (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255) NOT NULL, image_url VARCHAR(255), price DECIMAL(10, 2))`);
        await connection.query(`CREATE TABLE IF NOT EXISTS patient_medications (id INT AUTO_INCREMENT PRIMARY KEY, patient_id INT, medication_id INT, dosage VARCHAR(255), quantity_per_month INT DEFAULT 1, FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE, FOREIGN KEY (medication_id) REFERENCES medications(id) ON DELETE CASCADE)`);
        connection.release();
    } catch (error) {
        console.error("Database initialization failed:", error);
    }
}
initializeDatabase();

// =====================================
// 1. الدالة المسؤولة عن إضافة المريض
// =====================================
const addPatientHandler = async (req, res) => {
    try {
        const { qr_uuid, full_name, phone_number, medications } = req.body;
        const [patientResult] = await pool.execute(
            'INSERT INTO patients (qr_uuid, full_name, phone_number) VALUES (?, ?, ?)',
            [qr_uuid, full_name, phone_number]
        );
        const patientId = patientResult.insertId;

        if (medications && medications.length > 0) {
            for (const med of medications) {
                const [existingMed] = await pool.execute('SELECT id FROM medications WHERE name = ?', [med.name]);
                let medId;
                
                if (existingMed.length > 0) {
                    medId = existingMed[0].id;
                } else {
                    const [newMed] = await pool.execute(
                        'INSERT INTO medications (name, price) VALUES (?, ?)',
                        [med.name, med.price || 0]
                    );
                    medId = newMed.insertId;
                }

                await pool.execute(
                    'INSERT INTO patient_medications (patient_id, medication_id, dosage, quantity_per_month) VALUES (?, ?, ?, ?)',
                    [patientId, medId, med.dosage, 1]
                );
            }
        }
        res.status(201).json({ success: true, message: 'تم إضافة المريض وأدويته بنجاح' });
    } catch (error) {
        console.error("DETAILED ADD PATIENT ERROR:", error);
        // إرسال الخطأ الحقيقي للمتصفح لنراه بوضوح
        res.status(500).json({ success: false, message: error.message });
    }
};

// =====================================
// 2. الدالة المسؤولة عن جلب المريض
// =====================================
const getPatientHandler = async (req, res) => {
    try {
        const qr_uuid = req.params.qr_uuid;
        const [patientRows] = await pool.execute(
            'SELECT id, full_name, phone_number FROM patients WHERE qr_uuid = ?',
            [qr_uuid]
        );

        if (patientRows.length === 0) {
            return res.status(404).json({ success: false, message: 'بيانات المريض غير موجودة.' });
        }

        const patient = patientRows[0];
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
        console.error("DETAILED GET ERROR:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================================
// الحل السحري لتخطي كل مشاكل مسارات Vercel (Invincible Routing)
// ==========================================================

app.post('/api/patients', addPatientHandler);
app.post('/patients', addPatientHandler);
app.post('/', addPatientHandler); 

app.get('/api/patient/:qr_uuid', getPatientHandler);
app.get('/patient/:qr_uuid', getPatientHandler);

app.get('/', (req, res) => {
    res.send('Pharmacy API is running perfectly!');
});

if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
}
module.exports = app;