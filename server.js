const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static('public'));

// ข้อมูล Admin (ในการใช้งานจริงควรเก็บในฐานข้อมูลและเข้ารหัส)
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

// Middleware สำหรับตรวจสอบการล็อกอิน Admin
function requireAdminAuth(req, res, next) {
    const auth = req.headers.authorization;
    
    if (!auth || !auth.startsWith('Basic ')) {
        res.status(401).json({ error: 'ต้องล็อกอินก่อน' });
        return;
    }
    
    const credentials = Buffer.from(auth.slice(6), 'base64').toString();
    const [username, password] = credentials.split(':');
    
    if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
        next();
    } else {
        res.status(401).json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
    }
}

// สร้างฐานข้อมูล SQLite
const db = new sqlite3.Database('bookings.db');

// สร้างตาราง bookings
db.serialize(() => {
  // ตารางการจอง
  db.run(`CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    booker_name TEXT NOT NULL,
    contact TEXT,
    purpose TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // ตารางช่วงเวลาที่ปิดให้บริการ
  db.run(`CREATE TABLE IF NOT EXISTS blocked_times (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    reason TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

// API Routes

// ดูการจองทั้งหมดในวันที่กำหนด
app.get('/api/bookings/:date', (req, res) => {
  const date = req.params.date;
  
  db.all(
    'SELECT * FROM bookings WHERE date = ? ORDER BY time',
    [date],
    (err, bookings) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      
      db.all(
        'SELECT * FROM blocked_times WHERE date = ?',
        [date],
        (err, blocked) => {
          if (err) {
            res.status(500).json({ error: err.message });
            return;
          }
          
          res.json({ bookings, blocked });
        }
      );
    }
  );
});

// จองห้องประชุม
app.post('/api/bookings', (req, res) => {
  const { date, time, booker_name, contact, purpose } = req.body;
  
  // ตรวจสอบว่าช่วงเวลานี้ถูกจองแล้วหรือไม่
  db.get(
    'SELECT id FROM bookings WHERE date = ? AND time = ?',
    [date, time],
    (err, row) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      
      if (row) {
        res.status(400).json({ error: 'ช่วงเวลานี้ถูกจองแล้ว' });
        return;
      }
      
      // ตรวจสอบว่าช่วงเวลานี้ถูกปิดหรือไม่
      db.get(
        'SELECT id FROM blocked_times WHERE date = ? AND time = ?',
        [date, time],
        (err, blocked) => {
          if (err) {
            res.status(500).json({ error: err.message });
            return;
          }
          
          if (blocked) {
            res.status(400).json({ error: 'ช่วงเวลานี้ไม่เปิดให้บริการ' });
            return;
          }
          
          // บันทึกการจอง
          db.run(
            'INSERT INTO bookings (date, time, booker_name, contact, purpose) VALUES (?, ?, ?, ?, ?)',
            [date, time, booker_name, contact, purpose],
            function(err) {
              if (err) {
                res.status(500).json({ error: err.message });
                return;
              }
              
              res.json({ 
                id: this.lastID,
                message: 'จองสำเร็จ!',
                booking: {
                  id: this.lastID,
                  date,
                  time,
                  booker_name,
                  contact,
                  purpose
                }
              });
            }
          );
        }
      );
    }
  );
});

// API สำหรับล็อกอิน Admin
app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;
    
    if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
        res.json({ 
            success: true, 
            message: 'ล็อกอินสำเร็จ',
            token: Buffer.from(`${username}:${password}`).toString('base64')
        });
    } else {
        res.status(401).json({ 
            success: false, 
            error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' 
        });
    }
});

// ยกเลิกการจอง - เพิ่มการตรวจสอบ Admin
app.delete('/api/bookings/:id', requireAdminAuth, (req, res) => {
  const bookingId = req.params.id;
  
  db.run('DELETE FROM bookings WHERE id = ?', [bookingId], function(err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    
    if (this.changes === 0) {
      res.status(404).json({ error: 'ไม่พบการจองที่ต้องการยกเลิก' });
      return;
    }
    
    res.json({ message: 'ยกเลิกการจองสำเร็จ!' });
  });
});

// Admin APIs - เพิ่ม middleware ตรวจสอบการล็อกอิน

// ปิดช่วงเวลา
app.post('/api/admin/block-time', requireAdminAuth, (req, res) => {
  const { date, time, reason } = req.body;
  
  db.run(
    'INSERT INTO blocked_times (date, time, reason) VALUES (?, ?, ?)',
    [date, time, reason],
    function(err) {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      
      res.json({ 
        id: this.lastID,
        message: 'ปิดช่วงเวลาสำเร็จ!'
      });
    }
  );
});

// เปิดช่วงเวลา
app.delete('/api/admin/block-time/:id', requireAdminAuth, (req, res) => {
  const blockId = req.params.id;
  
  db.run('DELETE FROM blocked_times WHERE id = ?', [blockId], function(err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    
    res.json({ message: 'เปิดช่วงเวลาสำเร็จ!' });
  });
});

// ดูการจองทั้งหมด (สำหรับ admin)
app.get('/api/admin/all-bookings', requireAdminAuth, (req, res) => {
  db.all(
    'SELECT * FROM bookings ORDER BY date DESC, time ASC',
    [],
    (err, rows) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json(rows);
    }
  );
});

// หน้าหลัก
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// หน้า admin
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.listen(port, () => {
  console.log(`🌸 Meeting Room Booking App running at http://localhost:${port} 🌸`);
  console.log(`📝 Admin panel at http://localhost:${port}/admin`);
  console.log(`🔐 Admin credentials: username: ${ADMIN_USERNAME}, password: ${ADMIN_PASSWORD}`);
});

// ปิดฐานข้อมูลเมื่อปิดแอป
process.on('SIGINT', () => {
  db.close((err) => {
    if (err) {
      console.error(err.message);
    }
    console.log('Database connection closed.');
    process.exit(0);
  });
});