import app from '../src/app';

export default async (req, res) => {
  await app.ready(); // Si usas Fastify
  app.server.emit('request', req, res);
};