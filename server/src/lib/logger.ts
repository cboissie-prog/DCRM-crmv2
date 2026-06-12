import pino from 'pino'

const isDev = process.env.NODE_ENV !== 'production'

const logger = pino(
  {
    level: process.env.LOG_LEVEL ?? 'info',
  },
  isDev
    ? pino.transport({
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:HH:MM:ss',
          ignore: 'pid,hostname',
        },
      })
    : undefined,
)

export default logger
