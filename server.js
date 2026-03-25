const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

const app = express();
// ใช้ PORT จาก Environment Variable (สำหรับ Fly.io) หรือ 3000 เป็นค่าเริ่มต้น
const PORT = process.env.PORT || 3000;

// โหลดการตั้งค่า (ลองจาก Env ก่อน ถ้าไม่มีค่อยไปไฟล์ config.json)
let config;
try {
    config = require('./config.json');
} catch (e) {
    console.warn('⚠️ Warning: config.json not found, using Environment Variables for SMTP');
    config = {
        smtp: {
            host: process.env.SMTP_HOST,
            port: process.env.SMTP_PORT,
            secure: process.env.SMTP_SECURE === 'true',
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
        },
        email: {
            from: process.env.EMAIL_FROM,
            resetSubject: process.env.EMAIL_RESET_SUBJECT
        }
    };
}
// -------------------------------------------------------------------
// ตั้งค่าอีเมลสำหรับส่งลิงก์รีเซ็ตรหัสผ่าน โดยใช้ค่าจาก config.json
// -------------------------------------------------------------------
const transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: {
        user: config.smtp.user,
        pass: config.smtp.pass
    },
    tls: {
        rejectUnauthorized: false
    }
});

const SECRET_KEY = 'punya-clinic-super-secret-key';
// รองรับ DATA_DIR environment variable เพื่อใช้กับ Fly.io Volume ป้องกันข้อมูลหาย
const DATA_DIR = process.env.DATA_DIR || __dirname;
const USERS_FILE = path.join(DATA_DIR, 'users.json');

app.use(cors());
app.use(express.json());
// เปลี่ยนเป็นให้เปิดไฟล์อิงจากโฟลเดอร์ปัจจุบัน เพราะไม่ได้อยู่ใน public/ แล้ว
app.use(express.static(__dirname));

// Setup simple file-based DB
if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, JSON.stringify([]));
}

const getUsers = () => JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
const saveUsers = (users) => fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));

// Ensure default admin user exists
const initDefaultUser = async () => {
    const users = getUsers();
    if (!users.find(u => u.username === 'tanakon7572')) {
        const hashedPassword = await bcrypt.hash('Ta-27032543', 10);
        users.push({
            id: 'admin-001',
            email: 'admin@punyaclinic.com',
            name: 'Tanakon (Admin)',
            username: 'tanakon7572',
            password: hashedPassword,
            permissions: ['payment', 'shop', 'admin'] // เพิ่มสิทธิ์ให้เห็นทุกเมนู
        });
        saveUsers(users);
        console.log('✅ Default user "tanakon7572" has been created.');
    }
};
initDefaultUser();

// API: Register
app.post('/api/register', async (req, res) => {
    try {
        const { username, password, name } = req.body;

        if (!username || !password || !name) {
            return res.status(400).json({ error: 'กรุณากรอกข้อมูลให้ครบถ้วน (usernameรหัสผ่าน, ชื่อ)' });
        }

        const users = getUsers();

        if (users.find(u => u.username === username)) {
            return res.status(400).json({ error: 'Username นี้ถูกใช้งานแล้ว' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const newUser = {
            id: Date.now().toString(),
            email,
            name,
            username,
            password: hashedPassword,
            permissions: ['shop'] // สมาชิกทั่วไปเห็นแค่หน้าร้านค้าเบื้องต้น (ตัวอย่าง)
        };

        users.push(newUser);
        saveUsers(users);

        res.status(201).json({ message: 'สมัครสมาชิกสำเร็จ!' });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// API: Login
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: 'กรุณากรอก Username และ Password' });
        }

        const users = getUsers();
        const user = users.find(u => u.username === username);

        if (!user) {
            return res.status(401).json({ error: 'Username หรือ Password ไม่ถูกต้อง' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ error: 'Username หรือ Password ไม่ถูกต้อง' });
        }

        const token = jwt.sign(
            { id: user.id, username: user.username, name: user.name, permissions: user.permissions || [] },
            SECRET_KEY,
            { expiresIn: '1h' }
        );

        res.json({
            message: 'เข้าสู่ระบบสำเร็จ',
            token,
            user: {
                name: user.name,
                username: user.username,
                permissions: user.permissions || []
            }
        });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// API: Logout
app.post('/api/logout', (req, res) => {
    // สำรับการใช้ JWT (Stateless) การ Logout ฝั่ง Backend เป็นเพียงการรับทราบ
    // การทำงานจริงคือให้ Client ลบ Token ของตัวเองออกครับ
    res.json({ message: 'ออกจากระบบสำเร็จ' });
});

// API: Get current user profile (protected route) 
app.get('/api/profile', (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'ไม่พบ Token' });

    const token = authHeader.split(' ')[1];
    jwt.verify(token, SECRET_KEY, (err, decoded) => {
        if (err) return res.status(401).json({ error: 'Token หมดอายุหรือไม่ถูกต้อง' });
        res.json({ user: decoded });
    });
});

// API: For Admin - Get all users
app.get('/api/admin/users', (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'ไม่พบ Token' });

    const token = authHeader.split(' ')[1];
    jwt.verify(token, SECRET_KEY, (err, decoded) => {
        if (err) return res.status(401).json({ error: 'Token หมดอายุหรือไม่ถูกต้อง' });

        // เช็คสิทธิ์ว่าเป็น admin หรือไม่
        if (!decoded.permissions || !decoded.permissions.includes('admin')) {
            return res.status(403).json({ error: 'ไม่มีสิทธิ์เข้าถึง (Forbidden)' });
        }

        const users = getUsers();
        // ส่งกลับรายชื่อโดยซ่อน Password ไว้
        const publicUsers = users.map(u => ({
            id: u.id,
            name: u.name,
            username: u.username,
            email: u.email,
            permissions: u.permissions || []
        }));

        res.json({ users: publicUsers });
    });
});

// API: Forgot Password (ลืมรหัสผ่าน)
app.post('/api/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: 'กรุณากรอกอีเมล' });

        const users = getUsers();
        const userIndex = users.findIndex(u => u.email === email);

        if (userIndex === -1) {
            // เพื่อความปลอดภัย ไม่ควรบอกว่ามีหรือไม่มีอีเมลนี้ในระบบ (ป้องการโดนสุ่มเดาอีเมล)
            // แต่เพื่อการทดสอบง่ายๆ เราจะบอกผลลัพธ์ไปเลยว่าไม่พบอีเมล
            return res.status(404).json({ error: 'ไม่พบบัญชีที่ใช้อีเมลนี้' });
        }

        // สร้าง Token แรนดอม
        const resetToken = crypto.randomBytes(32).toString('hex');
        const tokenExpiry = Date.now() + 3600000; // หมดเวลาใน 1 ชั่วโมง

        // บันทึกลงใน base
        users[userIndex].resetToken = resetToken;
        users[userIndex].resetTokenExpiry = tokenExpiry;
        saveUsers(users);

        // สร้างลิงก์ให้ผู้ใช้กด (รองรับ APP_URL สำหรับโปรดักชั่น)
        const baseUrl = process.env.APP_URL || `http://localhost:${PORT}`;
        const resetLink = `${baseUrl}/reset-password.html?token=${resetToken}`;

        // จัดเตรียม Subject สำหรับ Taximail
        let finalSubject = config.email.resetSubject || 'ลิงก์สำหรับตั้งรหัสผ่านใหม่ (Reset Password)';
        const configParts = [];
        if (config.email.template_key) configParts.push(`X-TM-Template|:|${config.email.template_key}`);
        if (config.email.transactional_group) configParts.push(`X-TM-Transc-Group|:|${config.email.transactional_group}`);

        if (configParts.length > 0) {
            finalSubject = `{${configParts.join('::,')}} ${finalSubject}`;
        }

        // ตั้งค่าเนื้อหาอีเมล โดยดึงหัวข้อและชื่อผู้ส่งจาก config.json
        const mailOptions = {
            from: config.email.from,
            to: email,
            subject: finalSubject,
            html: `
                <h3>สวัสดีคุณ ${users[userIndex].name}</h3>
                <p>เราได้รับคำขอในการรีเซ็ตรหัสผ่านของคุณ</p>
                <p>กรุณาคลิกที่ลิงก์ด้านล่างเพื่อตั้งรหัสผ่านใหม่ (ลิงก์มีอายุ 1 ชั่วโมง):</p>
                <p><a href="${resetLink}" style="padding: 10px 20px; background-color: #B8860B; color: white; text-decoration: none; border-radius: 5px; display: inline-block;">คลิกที่นี่เพื่อตั้งรหัสผ่านใหม่</a></p>
                <br>
                <p>หรือก็อปลิงก์นี้ไปเปิดในบราวเซอร์:</p>
                <p><a href="${resetLink}">${resetLink}</a></p>
                <p>หากคุณไม่ได้ทำรายการนี้ กรุณาเพิกเฉยต่ออีเมลฉบับนี้</p>
            `,
            headers: {
                'X-Internal-Message-ID': `msg_${Date.now()}`
            }
        };

        // ส่งอีเมล (ใส่ try catch กัน Error เผื่อคนลืมเปลี่ยน SMTP)
        try {
            await transporter.sendMail(mailOptions);
            res.json({ message: 'ส่งลิงก์รีเซ็ตรหัสผ่านไปยังอีเมลของคุณเรียบร้อยแล้ว' });
        } catch (emailErr) {
            console.error('SMTP Send Error:', emailErr);
            // กรณีระบบยังไม่ได้ตั้งค่า SMTP หรือผิดพลาด ให้ปล่อยผ่าน และ Print ลิงก์ออกมาใน Console
            console.log(`[DEV MODE] Password Reset Link for ${email}: ${resetLink}`);
            res.status(500).json({ error: 'ไม่สามารถส่งอีเมลได้ (โปรดตรวจสอบการตั้งค่า SMTP) แต่สามารถเช็คลิงก์ใน Console ของเซิร์ฟเวอร์ได้' });
        }

    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// API: Reset Password (บันทึกรหัสผ่านใหม่)
app.post('/api/reset-password', async (req, res) => {
    try {
        const { token, newPassword } = req.body;
        if (!token || !newPassword) return res.status(400).json({ error: 'ข้อมูลไม่ครบถ้วน' });

        const users = getUsers();
        const userIndex = users.findIndex(u => u.resetToken === token && u.resetTokenExpiry > Date.now());

        if (userIndex === -1) {
            return res.status(400).json({ error: 'ลิงก์รีเซ็ตรหัสผ่านไม่ถูกต้อง หรือหมดอายุแล้ว (เกิน 1 ชั่วโมง)' });
        }

        // เข้ารหัสผ่านใหม่
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // อัปเดตรหัสผ่าน และลบ Token ทิ้งเพื่อความปลอดภัย
        users[userIndex].password = hashedPassword;
        delete users[userIndex].resetToken;
        delete users[userIndex].resetTokenExpiry;

        saveUsers(users);

        res.json({ message: 'ตั้งรหัสผ่านใหม่สำเร็จ' });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// API: SMTP / Taximail Test Trigger (สำหรับแอดมินเท่านั้น)
app.post('/api/test-smtp', async (req, res) => {
    // 1. ตรวจสอบสิทธิ์ (แอดมินเท่านั้น)
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'ไม่พบ Token (กรุณาล็อกอินเป็น Admin ก่อน)' });
    const token = authHeader.split(' ')[1];

    let isAdmin = false;
    try {
        const decoded = jwt.verify(token, SECRET_KEY);
        if (decoded.permissions && decoded.permissions.includes('admin')) isAdmin = true;
    } catch (e) { }

    if (!isAdmin) return res.status(403).json({ error: 'ไม่มีสิทธิ์เข้าถึง (เฉพาะแอดมิน)' });

    // 2. รับค่า Config จากฟอร์ม
    const {
        smtp_host, smtp_port, smtp_user, smtp_pass,
        test_connection_only, timeout, tls_rejectUnauthorized,
        template_key, transactional_group,
        from_email, to_email, subject_input, content_html, content_plain
    } = req.body;

    // 3. สร้าง Custom Logger สำหรับเก็บ Debug Output แบบที่ PHP ทำ
    const capturedLogs = [];
    const customLogger = {
        _log: (level, msg) => {
            const time = new Date().toISOString().replace('T', ' ').substr(0, 19);
            // แยกบรรทัดและ map เอาเฉพาะข้อมูลที่สำคัญ (Nodemailer ชอบส่ง object ลึกๆ มา)
            if (typeof msg === 'object') msg = JSON.stringify(msg);
            capturedLogs.push(`[${time}] [level ${level}] ${msg}`);
        },
        info: (e) => customLogger._log('info', e),
        debug: (e) => customLogger._log('debug', e),
        error: (e) => customLogger._log('error', e),
        warn: (e) => customLogger._log('warn', e),
        fatal: (e) => customLogger._log('fatal', e),
        trace: (e) => customLogger._log('trace', e)
    };

    // 4. สร้าง Transporter ชั่วคราวด้วยออปชันที่ผู้ใช้กรอกมา
    const testTransporter = nodemailer.createTransport({
        host: smtp_host,
        port: smtp_port,
        secure: smtp_port === 465, // SSL สำหรับพอร์ต 465
        auth: { user: smtp_user, pass: smtp_pass },
        connectionTimeout: timeout || 10000,
        tls: { rejectUnauthorized: tls_rejectUnauthorized !== false },
        logger: customLogger,
        debug: true // สั่งให้ Nodemailer คาย log ออกมา
    });

    try {
        // 5. โหมด Test Connection Only
        if (test_connection_only) {
            await testTransporter.verify();
            return res.json({
                success: true,
                message: `การเชื่อมต่อไปยัง ${smtp_host}:${smtp_port} สำเร็จยอดเยี่ยม!`,
                logs: capturedLogs
            });
        }

        // 6. โหมด Send Email
        // สร้าง Subject แบบมี Taximail Config พ่วงท้าย
        let finalSubject = subject_input || 'Test subject';
        const configParts = [];
        if (template_key) configParts.push(`X-TM-Template|:|${template_key}`);
        if (transactional_group) configParts.push(`X-TM-Transc-Group|:|${transactional_group}`);

        if (configParts.length > 0) {
            finalSubject = `{${configParts.join('::,')}} ${finalSubject}`;
        }

        const mailOptions = {
            from: from_email,
            to: to_email,
            subject: finalSubject,
            html: content_html || ' ',
            text: content_plain || ' ',
            headers: {
                'X-Internal-Message-ID': `msg_${Date.now()}`
            }
        };

        const info = await testTransporter.sendMail(mailOptions);

        return res.json({
            success: true,
            message: `ส่งอีเมลสำเร็จ! Message ID: ${info.messageId}`,
            logs: capturedLogs
        });

    } catch (err) {
        return res.status(500).json({
            success: false,
            error: err.message,
            logs: capturedLogs
        });
    }
});

// Start Server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on http://0.0.0.0:${PORT}`);
});
