const express = require('express')
const http = require('http')
const path = require('path')
require('dotenv').config()
const nodemailer = require('nodemailer')
const session = require('express-session')
const cookie = require('cookie-parser')
const sqlite3 = require('sqlite3')
const cookieParser = require('cookie-parser')
const { disconnect } = require('process')
const socketIo = require('socket.io')
const sharedsession = require('express-socket.io-session')
const app = express()
const server = http.createServer(app)
const io = socketIo(server)
const port = 3000
const dbPath = path.join(__dirname, '../SQLite Database/user_info.db')
const chatdbpath = path.join(__dirname , '../SQLite Database/chathistory.db')

//Opening the Database
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening Database')
    }
    else {
        console.log('Connected to SQLite Database')
        db.run("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT , username TEXT UNIQUE , password TEXT , email TEXT UNIQUE , role TEXT DEFAULT 'user')", (err) => {
            if (err) {
                console.log('error creating table', err.message)
            }
        })
        db.run('CREATE TABLE IF NOT EXISTS otps (id INTEGER PRIMARY KEY AUTOINCREMENT,otp INTEGER NOT NULL,email TEXT NOT NULL,created_at DATETIME DEFAULT CURRENT_TIMESTAMP,expires_at DATETIME)', (err) => {
            if (err) {
                console.log('error creating table', err.message)
            }
        })
    }

})
const chathistorydb = new sqlite3.Database(chatdbpath , (err) => {
    if (err){
        console.error('error opening database' , err)
    }
    else {
        console.log('Connected to SQLite3 chat history database')
    }
    chathistorydb.run('CREATE TABLE IF NOT EXISTS chathistory (id INTEGER PRIMARY KEY AUTOINCREMENT , username TEXT , message TEXT , timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)')

})

//middlewares
app.use(express.static(path.join(__dirname, '../public')))
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser())
app.use(express.json())

//middleware for session management
const sessionMiddleware = session({
    secret: 'kcgxy739902yujae', // Change this to a strong unique value
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false } // Set to true if using HTTPS
})
app.use(sessionMiddleware)
io.use(sharedsession(sessionMiddleware) , {
    autoSave: true
})
//middleware for role based access control
function isAdmin(req, res, next) {
    if (req.session.role === 'admin') {
        return next(); 
    }
    res.status(403).send('Access Denied!'); // Deny access for other emails
}
//middleware for authentication
function isAuthenticated(req, res, next) {
    if (req.session.isAuthenticated) {
        next()
    }
    else {
        res.sendFile(path.join(__dirname, 'error_auth.html'))
    }
}
//middleware for login page
function userIsLoggedIn(req, res, next) {
    if (req.session.isAuthenticated) {
        res.sendFile(path.join(__dirname , '../public/already_authenticated.html'))
    } else {
        next()
    } 
}

//Socket IO connections
io.on('connection', (socket) => {
    const user = socket.handshake.session.username
    chathistorydb.all('SELECT username , message , timestamp FROM chathistory ORDER BY id DESC LIMIT 20' , (err , rows) => {
        if (err){
            console.error('error:' , err)
        }
        socket.emit('chat-history' , rows.reverse())
    })
    console.log(`${user} has connected to the chatroom`)
    socket.on('chat message' , (message) => {
        chathistorydb.run('INSERT INTO chathistory (username , message) VALUES (? , ?)'  , [user , message.text] , (err)=>{
            if (err){
                console.error('Error Inserting Values' , err)
                return
            }else {
                console.log('values inserted into chat history table')
            }
        
            io.emit('chat message' , message)
        })
        
    })
    socket.on('disconnect' , () => {
        console.log(`${user} has disconnected`)
    })
})

//GET Requests
app.get('/admin/dashboard', isAdmin ,(req, res) => {
    res.send('this is admin page')
})
app.get('/', (req, res) => {
    res.send('Root Directory')
})
app.get('/settings', (req, res) => {
    res.send('This is Settings')
})
app.get('/chatroom', isAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname , '../public/chatroom.html'))
})
app.get('/home', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'))
})
app.get('/login',userIsLoggedIn, (req, res) => {
    res.sendFile(path.join(__dirname, '../public/login.html'))
})
app.get('/register', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/registration.html'))
})
app.get('/profile', isAuthenticated ,(req, res) => {
    res.sendFile(path.join(__dirname , '../public/profile.html'))
})
//endpoint for retrieving session specific data
app.get('/userdata', isAuthenticated ,  (req, res) => {
    res.json({
        username: req.session.username,
        email: req.session.email,
        role: req.session.role
    })
})
app.get('/logout' , isAuthenticated , (req , res) => {
    req.session.destroy(err => {
        if (err){
            console.error('Error Logging Out' , err)
            res.status(500).send('Internal Server Error')
        }else{
            res.redirect('/login')
        }

    })
})


//POST requests
app.post('/login', (req, res) => {
    const {username , password} = req.body
    db.get('SELECT * FROM users WHERE username=? AND password=?', [username, password], (err, user) => {
        if (err) {
            console.error('Error Querying Database')
        }
        else if (!user) {
            res.json({
                success: false , 
                message: 'Invalid Credentials or User Does not Exist'
            })
        }
        else {
            req.session.role = user.role
            req.session.username = user.username
            req.session.email = user.email
            req.session.isAuthenticated = true

            if (user.role === 'admin'){
                res.redirect('/admin/dashboard')
            }
            else {
                res.redirect('/chatroom')
            }
        }
    })

})
app.post('/register', (req, res) => {
    const { email } = req.body;

    // Check if the email is already registered
    db.get('SELECT * FROM users WHERE email = ?', [email], (err, row) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).send('Server Error');
        } else if (row) {
            return res.send('Email Already Registered');
        } else {
            // Generate OTP
            const otp = Math.floor(100000 + Math.random() * 900000);
            // Insert OTP into the database
            db.run('INSERT INTO otps (otp, email, created_at, expires_at) VALUES (?, ?, ?, ?)', 
                [otp, email, new Date().toISOString(), new Date(Date.now() + 3 * 60 * 1000).toISOString()], 
                function(err) {
                    if (err) {
                        console.error('Database error:', err);
                        return res.status(500).send('Server Error');
                    }

                    // Configure nodemailer
                    const transporter = nodemailer.createTransport({
                        service: 'gmail',
                        auth: {
                            user: process.env.EMAIL_USER, // Use environment variable
                            pass: process.env.EMAIL_PASS // Use environment variable
                        }
                    });

                    const mailOptions = {
                        from: process.env.EMAIL_USER,
                        to: email,
                        subject: 'Your OTP Code',
                        text: `Your OTP code is ${otp}. It will expire in 3 minutes.`
                    };

                    // Send the OTP email
                    transporter.sendMail(mailOptions, (error, info) => {
                        if (error) {
                            console.error('Email sending error:', error);
                            return res.status(500).send('Failed to send OTP');
                        }
                        
                        // Respond to user
                        res.redirect(`/enter_otp.html?email=${encodeURIComponent(email)}`);
                    });
                }
            );
        }
    });
});
//creating admin if not exists
const adminUsername = 'D3M0N'
const adminPassword = 'congratulations'
const role = 'admin'
const adminEmail = 'mrunknown9988@gmail.com'
db.serialize(() => {
    db.get('SELECT * FROM users WHERE role=?' , [role] , (err , user) =>{
        if (err){
            console.error('Error Querying Database')
        }
        if (!user){
            db.run('INSERT INTO users (username , password , email , role) VALUES (? , ? , ? , ?)' , [adminUsername , adminPassword , adminEmail , role] , (err) =>{
                if (err){
                    console.error('ERROR INSERTING VALUES')
                }
                else{
                    console.log('Admin Created')
                }
            })
        }
    })
})
app.post('/verify_otp', (req, res) => {
    const {email , otp , username , password} = req.body
    db.get('SELECT * FROM otps WHERE email=? AND otp=?' , [email , otp] ,(err , row) => {
        const now = new Date().toISOString()
        const expiresAt = new Date(row.expires_at)
        if (err){
            res.status(500).send('Internal Server Error');
            res.redirect('/register')
        }
        else if (now > expiresAt){
            return res.status(400).json({success: false , message: 'OTP has expired'})
        }
        else if (!row){
            res.status(400).json({
                success: false,
                message: 'Invalid OTP!'
            })
        }
        else {
            res.json({
                success: true,
                message: 'OTP Verification Successful'
            })
            db.run('INSERT INTO users (username , password , email) VALUES (? , ? ,?)' , [username , password , email] , (err) =>{
                if (err){
                    console.error('Error Inserting Values' , err)
                }
                else {
                    console.log('User Data Stored Successfully')
                }
            })
        }
    })
})
server.listen(port, () => {
    console.log(`Server is listening on port ${port}`);
});
