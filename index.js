const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
const uuid = require('uuid');
const mongoose = require('mongoose');
const config = require('./config');
const Validator = require('validatorjs');
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

    const voteSchema = new mongoose.Schema({
        option: String,
        count: Number
    });

    const Vote = mongoose.models.Vote || mongoose.model('Vote', voteSchema);

    Vote.countDocuments().then(count => {
        if (count === 0) {
            Vote.insertMany([
                { option: 'Stocks', count: 0 },
                { option: 'Real_estate', count: 0 },
                { option: 'Mutual_funds', count: 0 },
                { option: 'Cryptocurrencies', count: 0 }
            ]).then(() => console.log('Votes initialized'))
                .catch(err => console.log('Error inserting votes:', err));
        }
    }).catch(err => console.log('Error counting documents:', err));
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
    hasVoted: { type: Boolean, default: false } // Add this field
});

const voteSchema = new mongoose.Schema({
    option: String,
    count: Number,
});

const messageSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    text: String,
});

const User = mongoose.model('User', userSchema);
const Vote = mongoose.model('Vote', voteSchema);
const Message = mongoose.model('Message', messageSchema);

const users = {};

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

            res.status(200).json({ userId: user.id, username: user.username, id: user._id.toString() });
        })
        .catch(err => res.status(500).send('Error logging in'));
});

io.on('connection', (socket) => {
    console.log('a user connected');

    Vote.find()
        .then(votes => {
            const pollData = {};
            votes.forEach(vote => {
                pollData[vote.option] = vote.count;
            });
            socket.emit('updatePoll', pollData);
        })
        .catch(err => console.log('Error fetching votes:', err));

    socket.on('login', (userId) => {
        User.findOne({ id: userId })
            .then(user => {
                if (user) {
                    users[socket.id] = user;
                    socket.emit('loginSuccess', { username: user.username });
                    console.log(`${user.username} logged in`);
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
                    console.log('User not found');
                    socket.emit('error', { message: 'User not found' });
                }
            })
            .catch(err => console.log('Error logging in:', err));
    });

    socket.on('vote', (option) => {
        const user = users[socket.id];
        console.log('user', user);
        if (!user) {
            socket.emit('error', { message: 'User not found' });
            return;
        }

        if (user.hasVoted) {
            socket.emit('error', { message: 'You have already voted' });
            return;
        }

        Vote.findOneAndUpdate({ option }, { $inc: { count: 1 } }, { new: true })
            .then(updatedVote => {
                if (updatedVote) {
                    io.emit('updatePoll', { [option]: updatedVote.count });
                    user.hasVoted = true;
                    return User.updateOne({ _id: user._id }, { hasVoted: true });
                } else {
                    socket.emit('error', { message: 'Invalid vote option' });
                }
            })
            .catch(err => {
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
        Message.findById(id)
            .then(message => {
                if (!message) {
                    throw new Error('Message not found');
                }
                if (message.userId && message.userId.toString() === userId.toString()) {
                    return message.deleteOne();
                } else {
                    socket.emit('error', { message: 'You are not authorized to delete this message' });
                }
            })
            .then(deletedMessage => {
                if (deletedMessage) {
                    io.emit('deleteChatMessage', id);
                }
            })
            .catch(err => {
                socket.emit('error', { message: 'Not able to delete message' });
            });
    });

    socket.on('disconnect', () => {
        console.log('user disconnected');
        delete users[socket.id];
    });
});
const PORT = process.env.PORT || 8000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
