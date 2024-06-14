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
            loginSuccess(data.username);
            toastr.success('Registration successful');
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

    document.getElementById('login').style.display = 'block';
    document.getElementById('register').style.display = 'none';
    document.getElementById('poll').style.display = 'none';
    document.getElementById('chat').style.display = 'none';
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
            const data = await response.json();
            localStorage.setItem('userId', data.userId);
            localStorage.setItem('id', data.id);
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
    toggleDisplay(['poll', 'chat'], 'block');
    socket.emit('login', localStorage.getItem('userId'));
}

function vote(option) {
    socket.emit('vote', option);
}

socket.on('updatePoll', (pollData) => {
    Object.keys(pollData).forEach(option => {
        document.getElementById(option).textContent = pollData[option];
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

socket.on('error', (error) => {
    if (error.message === 'You are not authorized to edit this message') {
        toastr.error('You are not authorized to edit this message.');
    } else if (error.message === 'You are not authorized to delete this message') {
        toastr.error('You are not authorized to delete this message.');
    } else {
        toastr.error(error.message || 'An error occurred');
    }
});
