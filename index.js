const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
const uuid = require('uuid');
const mongoose = require('mongoose');
const config = require('./config');
const Validator = require('validatorjs');
const jwt = require("jsonwebtoken");
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(bodyParser.json());
app.use(express.static(__dirname + '/public'));

mongoose.connect(config.mongoURI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    ssl: true,
    tlsAllowInvalidCertificates: true,
}).then(() => {
    console.log('MongoDB connected');
}).catch(err => {
    console.log('Error connecting to MongoDB:', err);
    process.exit(1);
});

const userSchema = new mongoose.Schema({
    id: String,
    username: String,
    email: String,
    mobile: String,
    password: String,
    hasVoted: [{
        pollId: { type: mongoose.Schema.Types.ObjectId, ref: 'Poll' },
    }]
});

const pollSchema = new mongoose.Schema({
    question: String,
    options: [{ option: String, count: Number }],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
});

const messageSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    text: String,
});

const User = mongoose.model('User', userSchema);
const Poll = mongoose.model('Poll', pollSchema);
const Message = mongoose.model('Message', messageSchema);

const users = {};

// Middleware to verify JWT token
const verifyToken = (req, res, next) => {
    let token = req.headers['authorization'];
    if (!token) return res.status(403).send('No token provided');

    // Remove the 'Bearer ' prefix from the token if it exists
    if (token.startsWith('Bearer ')) {
        token = token.slice(7, token.length);
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
        if (err) return res.status(500).send('Failed to authenticate token');
        req.userId = decoded.id;
        next();
    });
};


app.post('/register', async (req, res) => {
    const validation = new Validator(req.body, {
        username: 'required',
        email: 'required|email',
        mobile: 'required|min:10|max:10',
        password: 'required|min:6',
    });
    if (validation.fails()) {
        return res.status(400).send(Object.values(validation.errors.all())[0][0]);
    }

    const { username, email, mobile, password } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    const id = uuid.v4();

    const existingUser = await User.findOne({ username });
    if (existingUser) {
        return res.status(401).send('Username is already taken');
    }

    const existingUserEmail = await User.findOne({ email });
    const existingUserMobile = await User.findOne({ mobile });
    if (existingUserEmail || existingUserMobile) {
        return res.status(401).send('User email or mobile already exists');
    }

    const newUser = new User({ id, username, email, mobile, password: hashedPassword });
    newUser.save()
        .then(user => res.status(200).json({ userId: user.id, username: user.username, id: user._id.toString() }))
        .catch(err => res.status(500).send('Error registering'));
});

app.post('/login', async (req, res) => {
    const validation = new Validator(req.body, {
        username: 'required',
        password: 'required',
    });
    if (validation.fails()) {
        return res.status(400).send(Object.values(validation.errors.all())[0][0]);
    }

    const { username, password } = req.body;
    User.findOne({ username })
        .then(async user => {
            if (!user || !(await bcrypt.compare(password, user.password))) {
                return res.status(401).send('Invalid username or password');
            }

            const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: 86400 });
            res.status(200).json({ userId: user.id, username: user.username, id: user._id.toString(), token });
        })
        .catch(err => res.status(500).send('Error logging in'));
});

app.post('/createPoll', verifyToken, async (req, res) => {
    const { question, options } = req.body;
    const newPoll = new Poll({
        question,
        options: options.map(option => ({ option, count: 0 })),
        createdBy: req.userId
    });

    newPoll.save()
        .then(poll => {
            io.emit('newPoll', poll);
            res.status(200).json(poll);
        })
        .catch(err => res.status(500).send('Error creating poll'));
});

app.get('/polls', (req, res) => {
    Poll.find()
        .populate('createdBy', 'username')
        .then(polls => res.status(200).json(polls))
        .catch(err => res.status(500).send('Error fetching polls'));
});

io.on('connection', (socket) => {
    console.log('a user connected');

    Poll.find()
        .then(polls => {
            socket.emit('allPolls', polls);
        })
        .catch(err => console.log('Error fetching polls:', err));

    socket.on('authenticate', ({ token }) => {
        jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
            if (err) {
                socket.emit('unauthorized', 'Invalid token');
                return;
            }
            User.findById(decoded.id)
                .then(user => {
                    if (user) {
                        users[socket.id] = user;
                        socket.emit('authenticated');
                        Message.find()
                            .populate('userId')
                            .then(messages => {
                                const messageData = messages.map(msg => ({
                                    id: msg._id,
                                    user: msg.userId.username,
                                    userId: msg.userId._id.toString(),
                                    text: msg.text
                                }));
                                socket.emit('chatHistory', messageData);
                            })
                            .catch(err => console.log('Error fetching messages:', err));
                    } else {
                        socket.emit('error', 'User not found');
                    }
                })
                .catch(err => console.log('Error logging in:', err));
        });
    });

    socket.on('vote', ({ pollId, option }) => {
        const user = users[socket.id];
        if (!user) {
            socket.emit('error', { message: 'User not found' });
            return;
        }
        if (Array.isArray(user.hasVoted)) {
            const hasVoted = user.hasVoted.find(vote => vote.pollId && vote.pollId.toString() === pollId);
            if (hasVoted) {
                socket.emit('error', { message: 'You have already voted on this poll' });
                return;
            }
        } else {
            socket.emit('error', { message: 'Invalid user voting data' });
            return;
        }


        Poll.findOneAndUpdate(
            { _id: pollId, 'options.option': option },
            { $inc: { 'options.$.count': 1 } },
            { new: true }
        )
            .then(updatedPoll => {
                if (updatedPoll) {
                    const newVote = { pollId: updatedPoll._id };

                    user.hasVoted = user.hasVoted && Array.isArray(user.hasVoted) ? user.hasVoted : [];

                    user.hasVoted.push(newVote);

                    return user.save();
                } else {
                    socket.emit('error', { message: 'Invalid vote option' });
                }
            })
            .then(updatedUser => {
                if (updatedUser) {
                    Poll.find()
                        .then(polls => {

                            socket.emit('allPolls', polls);
                        })
                        .catch(err => console.log('Error fetching polls:', err));
                    console.log('User vote recorded successfully');
                } else {
                    socket.emit('error', { message: 'Error updating user vote' });
                }
            })
            .catch(err => {
                console.log('Error recording vote:', err);
                socket.emit('error', { message: 'Error recording vote' });
            });

    });

    socket.on('chatMessage', (msg) => {
        const user = users[socket.id];
        if (!user) {
            socket.emit('error', { message: 'User not found' });
            return;
        }

        const message = new Message({ userId: user._id, text: msg });
        message.save()
            .then(savedMessage => {
                Message.populate(savedMessage, { path: 'userId' })
                    .then(populatedMessage => {
                        const messageData = { id: populatedMessage._id, userId: populatedMessage.userId._id.toString(), user: populatedMessage.userId.username, text: msg };
                        io.emit('newChatMessage', messageData);
                    })
                    .catch(err => {
                        socket.emit('error', { message: 'User not found' });
                    });
            })
            .catch(err => console.log('Error saving message:', err));
    });

    socket.on('editChatMessage', ({ id, text }) => {
        const userId = users[socket.id]._id;
        Message.findById(id).populate('userId')
            .then(message => {
                if (!message) {
                    throw new Error('Message not found');
                }
                if (message.userId && message.userId._id.toString() === userId.toString()) {
                    message.text = text;
                    return message.save();
                } else {
                    socket.emit('error', { message: 'You are not authorized to edit this message' });
                }
            })
            .then(updatedMessage => {
                if (updatedMessage) {
                    io.emit('editChatMessage', { id, text });
                }
            })
            .catch(err => {
                socket.emit('error', { message: 'Not able to edit message' });
            });
    });

    socket.on('deleteChatMessage', (id) => {
        const userId = users[socket.id]._id;
        Message.findOne({ _id: id }).populate('userId')
            .then(message => {
                if (!message) {
                    throw new Error('Message not found');
                }
                if (message.userId && message.userId._id.toString() === userId.toString()) {
                    return Message.deleteOne({ _id: id });
                } else {
                    socket.emit('error', { message: 'You are not authorized to delete this message' });
                }
            })
            .then(() => {
                io.emit('deleteChatMessage', id);
            })
            .catch(err => {
                console.log('Error deleting message:', err);
                socket.emit('error', { message: 'Not able to delete message' });
            });
    });


    socket.on('disconnect', () => {
        console.log('user disconnected');
        delete users[socket.id];
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
