import { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { isDev } from '../../config/env.js';

export function errorHandler(
  error: FastifyError | ZodError | Error,
  request: FastifyRequest,
  reply: FastifyReply
) {
  // Zod validation errors → 400
  if (error instanceof ZodError) {
    return reply.status(400).send({
      error: 'Validation failed',
      issues: error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }

  // Fastify validation errors → 400
  if ('validation' in error && error.validation) {
    return reply.status(400).send({
      error: 'Validation failed',
      details: error.validation,
    });
  }

  // Fastify HTTP errors (statusCode present)
  if ('statusCode' in error && error.statusCode) {
    return reply.status(error.statusCode).send({
      error: error.message,
    });
  }

  // Unknown errors → 500
  request.log.error({ err: error }, 'Unhandled error');

  return reply.status(500).send({
    error: 'Internal Server Error',
    ...(isDev && { message: error.message, stack: error.stack }),
  });
}