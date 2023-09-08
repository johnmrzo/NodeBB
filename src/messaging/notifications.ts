import winston from 'winston';
import user from '../user';
import notifications from '../notifications';
import sockets from '../socket.io';
import plugins from '../plugins';
import meta from '../meta';

interface MessagingInterface {  
    notifyUsersInRoom: (fromUid: string, roomId: string, messageObj: MessagingInterface) => Promise<void>;
    notifyQueue: {};
    system: object; 
    content: object;  
    // Methods for retrieving and manipulating user IDs in a chat room
    getUidsInRoom(roomId: string, start: number, end: number): Promise<string[]>;
    // Method for pushing an unread count
    pushUnreadCount(uid: string): void;
    // Method for checking if a chat room is a group chat
    isGroupChat(roomId: string): Promise<boolean>;
    // Add other properties and methods as needed...
    // For example:
    messageExists(mid: string): Promise<boolean>;
    parse(message: string, fromUid: string, uid: string, roomId: string, isNew: boolean): Promise<string>;
    isNewSet(uid: string, roomId: string, timestamp: number): Promise<boolean>;
    getRecentChats(callerUid: string, uid: string, start: number, stop: number): Promise<void>;
    generateUsernames(users: string[], excludeUid: string): string;
    getTeaser(uid: string, roomId: string): Promise<any>;
    getLatestUndeletedMessage(uid: string, roomId: string): Promise<string>;
    canMessageUser(uid: string, toUid: string): Promise<void>;
    canMessageRoom(uid: string, roomId: string): Promise<void>;
    hasPrivateChat(uid: string, withUid: string): Promise<number>;
    canViewMessage(mids: string[] | string, roomId: string, uid: string): Promise<boolean>;
}


export default function Notification(Messaging: MessagingInterface) {
    // The next line calls a function in a module that has not been updated to TS yet
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
    Messaging.notifyQueue = {}; // Only used to notify a user of a new chat message, see Messaging.notifyUser

    // The next line calls a function in a module that has not been updated to TS yet
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
    Messaging.notifyUsersInRoom = async (fromUid: string, roomId: string, messageObj: typeof Messaging) => {
        // The next line calls a function in a module that has not been updated to TS yet
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
        let uids: string[] = await Messaging.getUidsInRoom(roomId, 0, -1);

        // The next line calls a function in a module that has not been updated to TS yet
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
        uids = await user.blocks.filterUids(fromUid, uids);

        let data = {
            roomId: roomId,
            fromUid: fromUid,
            message: messageObj,
            uids: uids,
            self: 0,
        };
        data = await plugins.hooks.fire('filter:messaging.notify', data);
        if (!data || !data.uids || !data.uids.length) {
            return;
        }

        uids = data.uids;
        uids.forEach((uid) => {
            data.self = parseInt(uid, 10) === parseInt(fromUid, 10) ? 1 : 0;
            // The next line calls a function in a module that has not been updated to TS yet
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
            Messaging.pushUnreadCount(uid);

            // The next line calls a function in a module that has not been updated to TS yet
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
            sockets.in(`uid_${uid}`).emit('event:chats.receive', data);
        });

        // The next line calls a function in a module that has not been updated to TS yet
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
        if (messageObj.system) {
            return;
        }
        // Delayed notifications
        // The next line calls a function in a module that has not been updated to TS yet
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
        let queueObj = Messaging.notifyQueue[`${fromUid}:${roomId}`];
        // The next line calls a function in a module that has not been updated to TS yet
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
        if (queueObj) {
            queueObj.message.content += `\n${messageObj.content}`;
            clearTimeout(queueObj.timeout);
        } else {
            queueObj = {
                message: messageObj,
            };
            Messaging.notifyQueue[`${fromUid}:${roomId}`] = queueObj;
        }

        queueObj.timeout = setTimeout(async () => {
            try {
                await sendNotifications(fromUid, uids, roomId, queueObj.message);
            } catch (err) {
                winston.error(`[messaging/notifications] Unabled to send notification\n${err.stack}`);
            }
            // The next line calls a function in a module that has not been updated to TS yet
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
        }, meta.config.notificationSendDelay * 1000);
    };

    async function sendNotifications(fromuid: string, uids: string[], roomId: string, messageObj: any) {
        const isOnline = await user.isOnline(uids);
        // The next line calls a function in a module that has not been updated to TS yet
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
        uids = uids.filter((uid, index) => !isOnline[index] && parseInt(fromuid, 10) !== parseInt(uid, 10));
        if (!uids.length) {
            return;
        }

        // The next line calls a function in a module that has not been updated to TS yet
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
        const { displayname } = messageObj.fromUser;

        // The next line calls a function in a module that has not been updated to TS yet
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
        const isGroupChat: boolean = await Messaging.isGroupChat(roomId);
        const notification: string = await notifications.create({
            type: isGroupChat ? 'new-group-chat' : 'new-chat',
            subject: `[[email:notif.chat.subject, ${displayname}]]`,
            bodyShort: `[[notifications:new_message_from, ${displayname}]]`,
            // The next line calls a function in a module that has not been updated to TS yet
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
            bodyLong: messageObj.content,
            nid: `chat_${fromuid}_${roomId}`,
            from: fromuid,
            // The next line calls a function in a module that has not been updated to TS yet
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
            path: `/chats/${messageObj.roomId}`,
        });

        // The next line calls a function in a module that has not been updated to TS yet
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
        delete Messaging.notifyQueue[`${fromuid}:${roomId}`];
        notifications.push(notification, uids);
    }
}
