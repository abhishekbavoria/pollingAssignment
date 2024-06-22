const socket = io();

function toggleDisplay(elements, displayValue) {
    elements.forEach(elementId => {
        const element = document.getElementById(elementId);
        if (element) {
            element.style.display = displayValue;
        }
    });
}

async function register() {
    const username = document.getElementById('registerUsername').value;
    const email = document.getElementById('registerEmail').value;
    const mobile = document.getElementById('registerMobile').value;
    const password = document.getElementById('registerPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;

    if (!username || !email || !mobile || !password) {
        toastr.error('Please fill in all fields');
        return;
    }

    if (password !== confirmPassword) {
        toastr.error('Passwords do not match');
        return;
    }

    try {
        const response = await fetch('/register', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, email, mobile, password })
        });

        if (response.ok) {
            const data = await response.json();
            localStorage.setItem('userId', data.userId);
            localStorage.setItem('id', data.id);
            toastr.success('Registration successful');
            showLogin();
        } else {
            const errorData = await response.text();
            toastr.error(errorData || 'Registration failed');
        }
    } catch (error) {
        toastr.error('Registration failed');
    }
}

function showLogin() {
    toggleDisplay(['register'], 'none');
    toggleDisplay(['login'], 'block');
}

function logout() {
    localStorage.removeItem('userId');
    localStorage.removeItem('id');
    localStorage.removeItem('token');

    document.getElementById('login').style.display = 'block';
    document.getElementById('register').style.display = 'none';
    document.getElementById('poll').style.display = 'none';
    document.getElementById('chat').style.display = 'none';
    document.getElementById('createPoll').style.display = 'none';
    toastr.success('Logout successful');
}

async function login() {
    const username = document.getElementById('loginUsername').value;
    const password = document.getElementById('loginPassword').value;

    try {
        const response = await fetch('/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, password })
        });

        if (response.ok) {

            localStorage.removeItem('userId');
            localStorage.removeItem('id');
            localStorage.removeItem('token');

            const data = await response.json();
            localStorage.setItem('userId', data.userId);
            localStorage.setItem('id', data.id);
            localStorage.setItem('token', data.token);
            loginSuccess(data.username);
            toastr.success('Login successful');
        } else {
            const errorData = await response.text();
            toastr.error(errorData);
        }
    } catch (error) {
        toastr.error('Login failed');
    }
}

function loginSuccess(username) {
    toggleDisplay(['register', 'login'], 'none');
    toggleDisplay(['poll', 'chat', 'createPoll'], 'block');
    socket.emit('login', localStorage.getItem('userId'));
}

async function createPoll() {
    const question = document.getElementById('pollQuestion').value;
    const options = [
        document.getElementById('option1').value,
        document.getElementById('option2').value,
        document.getElementById('option3').value,
        document.getElementById('option4').value
    ];

    if (!question || options.some(option => !option)) {
        toastr.error('Please fill in all fields');
        return;
    }

    try {
        const response = await fetch('/createPoll', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: JSON.stringify({ question, options })
        });

        if (response.ok) {
            toastr.success('Poll created successfully');
            document.getElementById('pollForm').reset();
        } else {
            const errorData = await response.text();
            toastr.error(errorData || 'Poll creation failed');
        }
    } catch (error) {
        toastr.error('Poll creation failed');
    }
}

function vote(pollId, option) {
    socket.emit('vote', { pollId, option });
}

socket.on('updatePoll', (pollData) => {
    const pollContainer = document.getElementById('pollResults');
    pollContainer.innerHTML = '';
    pollData.forEach(poll => {
        const pollElement = document.createElement('div');
        pollElement.innerHTML = `
            <h3>${poll.question}</h3>
            ${poll.options.map((option, index) => `
                <button onclick="vote('${option}', '${poll._id}')">${option} - <span id="${poll._id}-${index}">${poll.votes[option] || 0}</span></button>
            `).join('')}
        `;
        pollContainer.appendChild(pollElement);
    });
});

socket.on('chatHistory', (messages) => {
    const messagesDiv = document.getElementById('messages');
    messages.forEach(msg => {
        addMessageElement(msg);
    });
});

socket.on('newChatMessage', (msg) => {
    addMessageElement(msg);
});

function sendMessage() {
    const input = document.getElementById('messageInput');
    const message = input.value;
    if (message) {
        socket.emit('chatMessage', message);
        input.value = '';
    }
}

function showTypingIndicator() {
    socket.emit('typing');
}

socket.on('typing', (username) => {
    const typingIndicator = document.getElementById('typingIndicator');
    typingIndicator.textContent = `${username} is typing...`;
    typingIndicator.style.display = 'block';
    setTimeout(() => {
        typingIndicator.style.display = 'none';
    }, 1000);
});

function addMessageElement(msg) {
    const messagesDiv = document.getElementById('messages');
    const userId = localStorage.getItem('id');
    const isOwner = msg.userId === userId;

    const messageElement = document.createElement('div');
    messageElement.innerHTML = `
        <p>
            <strong>${msg.user}:</strong> 
            <span id="message-text-${msg.id}">${msg.text}</span>
            ${isOwner ? `<i class="fas fa-edit" onclick="editMessage('${msg.id}')"></i>` : ''}
            ${isOwner ? `<i class="fas fa-trash" onclick="deleteMessage('${msg.id}')"></i>` : ''}
        </p>
    `;
    messageElement.id = `message-${msg.id}`;
    messagesDiv.appendChild(messageElement);
}

function editMessage(id) {
    const newText = prompt('Edit your message:');
    if (newText) {
        socket.emit('editChatMessage', { id, text: newText });
    }
}

function deleteMessage(id) {
    socket.emit('deleteChatMessage', id);
}

socket.on('editChatMessage', (data) => {
    const messageTextElement = document.getElementById(`message-text-${data.id}`);
    if (messageTextElement) {
        messageTextElement.textContent = data.text;
        toastr.success('Message edited successfully');
    }
});

socket.on('deleteChatMessage', (id) => {
    const messageElement = document.getElementById(`message-${id}`);
    if (messageElement) {
        messageElement.remove();
        toastr.success('Message deleted successfully');
    }
});

socket.on('newPoll', (poll) => {
    addPollElement(poll);
});

function addPollElement(poll) {

    const pollDiv = document.getElementById('poll');
    const pollElement = document.createElement('div');
    pollElement.innerHTML = `
        <h3>${poll.question}</h3>
        ${poll.options.map(option => `
            <button onclick="vote('${poll._id}', '${option.option}')">${option.option} - ${option.count}</button>
        `).join('')}
    `;
    pollDiv.appendChild(pollElement);
}

socket.on('allPolls', (polls) => {
    const pollDiv = document.getElementById('poll');

    while (pollDiv.firstChild) {
        pollDiv.removeChild(pollDiv.firstChild);
    }

    polls.forEach(poll => {
        const pollElement = document.createElement('div');
        pollElement.innerHTML = `
        <h3>${poll.question}</h3>
        ${poll.options.map(option =>
            `<button onclick="vote('${poll._id}', '${option.option}')">${option.option} - ${option.count}</button>`
        ).join('')}
    `;
        pollDiv.appendChild(pollElement);
    });
});


socket.on('error', (error) => {
    if (error.message === 'You are not authorized to edit this message') {
        toastr.error('You are not authorized to edit this message.');
    } else if (error.message === 'You are not authorized to delete this message') {
        toastr.error('You are not authorized to delete this message.');
    } else {
        toastr.error(error.message || 'An error occurred');
    }
});

// Ensure socket connection includes token
socket.on('connect', () => {
    const token = localStorage.getItem('token');
    if (token) {
        socket.emit('authenticate', { token });
    }
});

socket.on('authenticated', () => {
    console.log('Socket authenticated');
});

socket.on('unauthorized', (msg) => {
    console.log('Socket authentication failed:', msg);
    toastr.error('Socket authentication failed. Please log in again.');
    logout();
});
