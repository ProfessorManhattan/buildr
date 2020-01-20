import { default as Pino } from 'pino';

export const pinoLog = Pino({
    prettyPrint: {
        ignore: 'hostname,pid',
        translateTime: 'SYS:HH:MM:ss.l o'
    }
});

export class Logger {
    public error(...args) {
        pinoLog.error(args);
    }

    public info(...args) {
        pinoLog.info(args);
    }

    public log(...args) {
        pinoLog.log(args);
    }

    public warn(...args) {
        pinoLog.warn(args);
    }
}