'use strict';

import * as winston from 'winston';
import * as user from '../user';
import * as notifications from '../notifications';
import * as sockets from '../socket.io';
import * as plugins from '../plugins';
import * as meta from '../meta';

interface Messaging {
  notifyUsersInRoom: (fromUid: string, roomId: string, messageObj: MessageObject) => Promise<void>;
  notifyQueue: {};
  getUidsInRoom(roomId: string, start: number, end: number): Promise<string[]>;
  pushUnreadCount(uid: string): void;
  isGroupChat(roomId: string): Promise<boolean>;
}

interface MessageObject {
  system: boolean;
  content: string;
  fromUser: { displayname: string };
  roomId: string;
}

interface NotifyData {
  roomId: string;
  fromUid: string;
  message: MessageObject;
  uids: string[];
  self?: number;
}

module.exports = function (Messaging: Messaging) {
  Messaging.notifyQueue = {};

  Messaging.notifyUsersInRoom = async (fromUid: string, roomId: string, messageObj: MessageObject) => {
    let uids: string[] = await Messaging.getUidsInRoom(roomId, 0, -1);
    uids = await user.blocks.filterUids(fromUid, uids);

    let data: NotifyData = {
      roomId: roomId,
      fromUid: fromUid,
      message: messageObj,
      uids: uids,
    };

    data = await plugins.hooks.fire('filter:messaging.notify', data);
    if (!data || !data.uids || !data.uids.length) {
      return;
    }

    uids = data.uids;
    uids.forEach((uid: string) => {
      data.self = parseInt(uid, 10) === parseInt(fromUid, 10) ? 1 : 0;
      Messaging.pushUnreadCount(uid);
      sockets.in(`uid_${uid}`).emit('event:chats.receive', data);
    });
    if (messageObj.system) {
      return;
    }

    let queueObj = Messaging.notifyQueue[`${fromUid}:${roomId}`];
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
        winston.error(`[messaging/notifications] Unable to send notification\n${err.stack}`);
      }
    }, meta.config.notificationSendDelay * 1000);
  };

  async function sendNotifications(fromuid: string, uids: string[], roomId: string, messageObj: MessageObject) {
    const isOnline = await user.isOnline(uids);
    uids = uids.filter((uid, index) => !isOnline[index] && parseInt(fromuid, 10) !== parseInt(uid, 10));
    if (!uids.length) {
      return;
    }

    const { displayname } = messageObj.fromUser;

    const isGroupChat = await Messaging.isGroupChat(roomId);
    const notification = await notifications.create({
      type: isGroupChat ? 'new-group-chat' : 'new-chat',
      subject: `[[email:notif.chat.subject, ${displayname}]]`,
      bodyShort: `[[notifications:new_message_from, ${displayname}]]`,
      bodyLong: messageObj.content,
      nid: `chat_${fromuid}_${roomId}`,
      from: fromuid,
      path: `/chats/${messageObj.roomId}`,
    });

    delete Messaging.notifyQueue[`${fromuid}:${roomId}`];
    notifications.push(notification, uids);
  }
};
