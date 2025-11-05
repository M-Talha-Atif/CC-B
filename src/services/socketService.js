let io = null;

// Store user socket connections
const userSockets = new Map(); // userId -> Set of socketIds

const initializeSocket = (server) => {
  const socketIO = require('socket.io');
  
  io = socketIO(server, {
    cors: {
      origin: "*", // Change this in production
      methods: ["GET", "POST"],
    },
  });

  io.on('connection', (socket) => {
    console.log(`🔌 Socket connected: ${socket.id}`);

    // Authenticate user on connection
    socket.on('authenticate', (userId) => {
      if (!userId) return;
      
      // Store socket connection
      if (!userSockets.has(userId)) {
        userSockets.set(userId, new Set());
      }
      userSockets.get(userId).add(socket.id);
      
      // Join user to their personal room
      socket.join(`user:${userId}`);
      console.log(`✅ User ${userId} authenticated on socket ${socket.id}`);
    });

    // Handle disconnect
    socket.on('disconnect', () => {
      console.log(`🔌 Socket disconnected: ${socket.id}`);
      
      // Remove socket from all users
      for (const [userId, sockets] of userSockets.entries()) {
        sockets.delete(socket.id);
        if (sockets.size === 0) {
          userSockets.delete(userId);
        }
      }
    });

    // Mark notification as read
    socket.on('mark_read', async ({ notificationId, userId }) => {
      // This will be handled by the controller, but we can emit acknowledgment
      socket.emit('notification_read', { notificationId });
    });
  });

  return io;
};

const getIO = () => {
  if (!io) {
    throw new Error('Socket.io not initialized!');
  }
  return io;
};

// Send notification to specific user
const emitToUser = (userId, event, data) => {
  if (!io) return;
  io.to(`user:${userId}`).emit(event, data);
};

// Check if user is online
const isUserOnline = (userId) => {
  return userSockets.has(userId) && userSockets.get(userId).size > 0;
};

module.exports = {
  initializeSocket,
  getIO,
  emitToUser,
  isUserOnline,
};