import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { Server } from 'socket.io';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { readDb, writeDb } from './dataStore.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, 'data', 'db.json');
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*'
  }
});

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

app.use(cors());
app.use(express.json());

function createToken(user) {
  return jwt.sign({ id: user.id, name: user.name, email: user.email }, JWT_SECRET, {
    expiresIn: '7d'
  });
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ message: 'Unauthorized' });
  }
}

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.post('/api/auth/register', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ message: 'Name, email and password are required.' });
  }

  const db = await readDb(dbPath);
  const existingUser = db.users.find((user) => user.email.toLowerCase() === email.toLowerCase());

  if (existingUser) {
    return res.status(409).json({ message: 'Email already registered.' });
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const user = {
    id: uuidv4(),
    name,
    email: email.toLowerCase(),
    password: hashedPassword,
    createdAt: new Date().toISOString()
  };

  db.users.push(user);
  await writeDb(dbPath, db);

  res.status(201).json({ token: createToken(user), user: { id: user.id, name: user.name, email: user.email } });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required.' });
  }

  const db = await readDb(dbPath);
  const user = db.users.find((entry) => entry.email.toLowerCase() === email.toLowerCase());

  if (!user) {
    return res.status(401).json({ message: 'Invalid credentials.' });
  }

  const validPassword = await bcrypt.compare(password, user.password);
  if (!validPassword) {
    return res.status(401).json({ message: 'Invalid credentials.' });
  }

  res.json({ token: createToken(user), user: { id: user.id, name: user.name, email: user.email } });
});

app.get('/api/auth/me', authMiddleware, async (req, res) => {
  const db = await readDb(dbPath);
  const user = db.users.find((entry) => entry.id === req.user.id);

  if (!user) {
    return res.status(404).json({ message: 'User not found.' });
  }

  res.json({ user: { id: user.id, name: user.name, email: user.email } });
});

app.get('/api/projects', authMiddleware, async (req, res) => {
  const db = await readDb(dbPath);
  const projects = db.projects.filter((project) => {
    return project.ownerId === req.user.id || project.members.some((member) => member.id === req.user.id);
  });

  res.json({ projects });
});

app.post('/api/projects', authMiddleware, async (req, res) => {
  const { name, description } = req.body;
  if (!name) {
    return res.status(400).json({ message: 'Project name is required.' });
  }

  const db = await readDb(dbPath);
  const project = {
    id: uuidv4(),
    name,
    description: description || '',
    ownerId: req.user.id,
    members: [{ id: req.user.id, name: req.user.name, email: req.user.email }],
    tasks: [],
    createdAt: new Date().toISOString()
  };

  db.projects.push(project);
  await writeDb(dbPath, db);

  io.emit('projects:updated', { project });
  res.status(201).json({ project });
});

app.get('/api/projects/:id', authMiddleware, async (req, res) => {
  const db = await readDb(dbPath);
  const project = db.projects.find((entry) => entry.id === req.params.id);

  if (!project) {
    return res.status(404).json({ message: 'Project not found.' });
  }

  if (project.ownerId !== req.user.id && !project.members.some((member) => member.id === req.user.id)) {
    return res.status(403).json({ message: 'You do not have access to this project.' });
  }

  res.json({ project });
});

app.post('/api/projects/:id/tasks', authMiddleware, async (req, res) => {
  const { title, description, priority, status, assigneeEmail } = req.body;
  if (!title) {
    return res.status(400).json({ message: 'Task title is required.' });
  }

  const db = await readDb(dbPath);
  const project = db.projects.find((entry) => entry.id === req.params.id);

  if (!project) {
    return res.status(404).json({ message: 'Project not found.' });
  }

  const assignee = assigneeEmail
    ? db.users.find((user) => user.email.toLowerCase() === assigneeEmail.toLowerCase())
    : null;

  const task = {
    id: uuidv4(),
    title,
    description: description || '',
    priority: priority || 'medium',
    status: status || 'todo',
    assigneeId: assignee?.id || null,
    assigneeName: assignee?.name || null,
    assigneeEmail: assignee?.email || null,
    comments: [],
    createdAt: new Date().toISOString()
  };

  project.tasks.push(task);
  await writeDb(dbPath, db);

  io.to(req.params.id).emit('tasks:updated', { projectId: project.id, task });
  io.emit('projects:updated', { project });
  res.status(201).json({ task });
});

app.patch('/api/tasks/:id', authMiddleware, async (req, res) => {
  const db = await readDb(dbPath);
  let taskFound = null;
  let projectId = null;

  for (const project of db.projects) {
    const task = project.tasks.find((entry) => entry.id === req.params.id);
    if (task) {
      taskFound = task;
      projectId = project.id;
      break;
    }
  }

  if (!taskFound) {
    return res.status(404).json({ message: 'Task not found.' });
  }

  taskFound.status = req.body.status || taskFound.status;
  taskFound.priority = req.body.priority || taskFound.priority;
  taskFound.title = req.body.title || taskFound.title;
  taskFound.description = req.body.description ?? taskFound.description;
  taskFound.assigneeEmail = req.body.assigneeEmail ?? taskFound.assigneeEmail;

  if (req.body.assigneeEmail) {
    const assignee = db.users.find((user) => user.email.toLowerCase() === req.body.assigneeEmail.toLowerCase());
    taskFound.assigneeId = assignee?.id || null;
    taskFound.assigneeName = assignee?.name || null;
    taskFound.assigneeEmail = assignee?.email || null;
  }

  await writeDb(dbPath, db);

  io.to(projectId).emit('tasks:updated', { projectId, task: taskFound });
  res.json({ task: taskFound });
});

app.post('/api/tasks/:id/comments', authMiddleware, async (req, res) => {
  const { text } = req.body;
  if (!text) {
    return res.status(400).json({ message: 'Comment text is required.' });
  }

  const db = await readDb(dbPath);
  let taskFound = null;
  let projectId = null;

  for (const project of db.projects) {
    const task = project.tasks.find((entry) => entry.id === req.params.id);
    if (task) {
      taskFound = task;
      projectId = project.id;
      break;
    }
  }

  if (!taskFound) {
    return res.status(404).json({ message: 'Task not found.' });
  }

  const comment = {
    id: uuidv4(),
    userId: req.user.id,
    userName: req.user.name,
    text,
    createdAt: new Date().toISOString()
  };

  taskFound.comments.push(comment);
  await writeDb(dbPath, db);

  io.to(projectId).emit('comments:updated', { projectId, taskId: req.params.id, comment });
  res.status(201).json({ comment });
});

io.on('connection', (socket) => {
  socket.on('join-project', (projectId) => {
    if (projectId) {
      socket.join(projectId);
    }
  });

  socket.on('leave-project', (projectId) => {
    if (projectId) {
      socket.leave(projectId);
    }
  });
});

const PORT = process.env.PORT || 4000;
httpServer.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
});
