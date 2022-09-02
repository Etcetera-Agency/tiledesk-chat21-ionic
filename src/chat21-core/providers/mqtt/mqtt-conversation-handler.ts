import { Chat21HttpService } from 'src/chat21-core/providers/native/chat21http.service';
import { Inject, Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

import { LoggerService } from '../abstract/logger.service';
import { LoggerInstance } from '../logger/loggerInstance';

// mqtt
import {Chat21Service} from './chat-service';

// models
import { MessageModel } from '../../models/message';
import { UserModel } from '../../models/user';

// services
import { ConversationHandlerService } from '../abstract/conversation-handler.service';

// utils
import { MSG_STATUS_RECEIVED, CHAT_REOPENED, CHAT_CLOSED, MEMBER_JOINED_GROUP, TYPE_DIRECT, MESSAGE_TYPE_INFO } from '../../utils/constants';
import {
  htmlEntities,
  compareValues,
  searchIndexInArrayForUid,
  setHeaderDate,
  conversationMessagesRef
} from '../../utils/utils';
import { v4 as uuidv4 } from 'uuid';
import { hideInfoMessage, isJustRecived, messageType } from '../../utils/utils-message';


@Injectable({ providedIn: 'root' })
export class MQTTConversationHandler extends ConversationHandlerService {

    // BehaviorSubject
    messageAdded: BehaviorSubject<MessageModel> = new BehaviorSubject<MessageModel>(null);;
    messageChanged: BehaviorSubject<MessageModel> = new BehaviorSubject<MessageModel>(null);;
    messageRemoved: BehaviorSubject<string> = new BehaviorSubject<string>(null);
    messageWait: BehaviorSubject<any> = new BehaviorSubject<string>(null);
    messageInfo: BehaviorSubject<MessageModel> = new BehaviorSubject<MessageModel>(null);
    
    // public variables
    public attributes: any;
    public messages: MessageModel[];
    public conversationWith: string;

    // private variables
    private translationMap: Map<string, string>; // LABEL_TODAY, LABEL_TOMORROW
    // private urlNodeFirebase: string;
    private recipientId: string;
    private recipientFullname: string;
    private tenant: string;
    private loggedUser: UserModel;
    private senderId: string;
    private listSubsriptions: any[];
    private CLIENT_BROWSER: string;
    private startTime: Date = new Date();
    private lastDate = '';

    private logger: LoggerService = LoggerInstance.getInstance()

    constructor(
        public chat21HttpService : Chat21HttpService,
        @Inject('skipMessage') private skipInfoMessage: boolean
    ) {
        super();
    }

    /**
     * inizializzo conversation handler
     */
    initialize(recipientId: string,recipientFullName: string,loggedUser: UserModel,tenant: string, translationMap: Map<string, string>) {
        this.logger.log('[MQTTConversationHandler] initWithRecipient:', tenant);
        this.recipientId = recipientId;
        this.recipientFullname = recipientFullName;
        this.loggedUser = loggedUser;
        if (loggedUser) {
            this.senderId = loggedUser.uid;
        }
        // this.tenant = tenant;
        // this.translationMap = translationMap;

        this.listSubsriptions = [];
        // this.CLIENT_BROWSER = navigator.userAgent;
        this.conversationWith = recipientId;
        this.messages = [];
        // this.attributes = this.setAttributes();
    }

    /**
     * mi connetto al nodo messages
     * recupero gli ultimi 100 messaggi
     * creo la reference
     * mi sottoscrivo a change, removed, added
     */
    connect() {
        this.logger.log('[MQTTConversationHandler] connecting conversation handler...', this.conversationWith);
        if (this.conversationWith == null) {
            this.logger.error('[MQTTConversationHandler] cant connect invalid this.conversationWith', this.conversationWith);
            return;
        }
        // this.chat21Service.chatClient.lastMessages(this.conversationWith, (err, messages) => {
        //     if (!err) {
        //         messages.forEach(msg => {
        //             this.addedMessage(msg);
        //         });
        //     }
        // });
        const handler_message_added = this.chat21HttpService.chatClient.onMessageAddedInConversation(
            this.conversationWith, (message, topic) => {
                this.logger.log('[MQTTConversationHandler] message added:', message, 'on topic:', topic);
                const msg: MessageModel = message
                msg.uid = message.message_id;
                if (msg.attributes && msg.attributes.commands) {
                    this.logger.debug('[MQTTConversationHandler] splitted message::::', msg)
                    this.addCommandMessage(msg)
                } else {
                    this.logger.debug('[MQTTConversationHandler] NOT splitted message::::', msg)
                    this.added(msg)
                }
        });
        const handler_message_updated = this.chat21HttpService.chatClient.onMessageUpdatedInConversation(
            this.conversationWith,  (message, topic) => {
            this.logger.log('[MQTTConversationHandler] message updated:', message, 'on topic:', topic);
            this.changed(message);
        });
    }

    // isGroup(groupId) {
    //     if (groupId.indexOf('group-') >= 0) {
    //         return true;
    //     }
    //     return false;
    // }

    /**
     * bonifico url in testo messaggio
     * recupero time attuale
     * recupero lingua app
     * recupero senderFullname e recipientFullname
     * aggiungo messaggio alla reference
     * @param msg
     * @param conversationWith
     * @param conversationWithDetailFullname
     */
    // sendMessage(
    //     msg,
    //     type,
    //     metadata,
    //     this.conversationWith,
    //     this.conversationWithFullname,
    //     this.loggedUser.uid,
    //     fullname,
    //     this.channelType
    //   );
    sendMessage(
        msg: string,
        typeMsg: string,
        metadataMsg: string,
        conversationWith: string,
        conversationWithFullname: string,
        sender: string,
        senderFullname: string,
        channelType: string,
        attributes: any
    ) {
        const that = this;
        if (!channelType || channelType === 'undefined') {
            channelType = TYPE_DIRECT;
        }

        this.logger.log('[MQTTConversationHandler] Senderfullname & channelType', senderFullname, channelType);
        const language = document.documentElement.lang;
        const recipientFullname = conversationWithFullname;
        const recipientId = conversationWith;
        attributes.lang = language;
        this.chat21HttpService.chatClient.sendMessage(
            msg,
            typeMsg,
            recipientId,
            recipientFullname,
            senderFullname,
            attributes,
            metadataMsg,
            channelType,
            // language,
            (err, message) => {
                if (err) {
                    message.status = '-100';
                    this.logger.log('[MQTTConversationHandler] ERROR', err);
                } else {
                    message.status = '150';
                }
            }
        );
        return new MessageModel(
            '',
            language,
            conversationWith,
            recipientFullname,
            sender,
            senderFullname,
            0,
            metadataMsg,
            msg,
            Date.now(),
            typeMsg,
            this.attributes,
            channelType,
            false
        );
    }

    /**
     * dispose reference della conversazione
     */
    dispose() {
        // this.ref.off();
    }


    // ---------------------------------------------------------- //
    // BEGIN PRIVATE FUNCTIONS
    // ---------------------------------------------------------- //
    /** */
    // private setAttributes(): any {
    //     let attributes: any = JSON.parse(sessionStorage.getItem('attributes'));
    //     if (!attributes || attributes === 'undefined') {
    //         attributes = {
    //             client: this.CLIENT_BROWSER,
    //             sourcePage: location.href,
    //             userEmail: this.loggedUser.email,
    //             userFullname: this.loggedUser.fullname
    //         };
    //         this.logger.log('>>>>>>>>>>>>>> setAttributes: ', JSON.stringify(attributes));
    //         sessionStorage.setItem('attributes', JSON.stringify(attributes));
    //     }
    //     return attributes;
    // }

    /** */
    private added(message: MessageModel) {
        const msg = this.chat21HttpService.messageGenerate(message);
        let isInfoMessage = messageType(MESSAGE_TYPE_INFO, msg)
        if(isInfoMessage && hideInfoMessage(msg, this.chat21HttpService.showInfoMessage)){
            //if showBubbleInfoMessage array keys not includes msg.attributes.messagelabel['key'] exclude CURRENT INFO MESSAGE
            return;
        } else if(isInfoMessage && !hideInfoMessage(msg, this.chat21HttpService.showInfoMessage)){
            // if(!checkIfIsMemberJoinedGroup(msg, this.loggedUser)){
            //         //skipMessage= false: if showInfoMessageKeys includes msg.attributes.messagelabel['key'] include CURRENT INFO MESSAGE
            //         //only if a member (not a bot) has joined the group
            //     return;
            // }
        }

        if(isInfoMessage){
            this.messageInfo.next(msg)
        }
        // imposto il giorno del messaggio per visualizzare o nascondere l'header data
        // msg.headerDate = null;
        // const headerDate = setHeaderDate(this.translationMap, msg.timestamp);
        // if (headerDate !== this.lastDate) {
        //     this.lastDate = headerDate;
        //     msg.headerDate = headerDate;
        // }
        this.logger.log('[MQTTConversationHandler] adding message:' + JSON.stringify(msg));
        // this.logger.log('childSnapshot.message_id:' + msg.message_id);
        // this.logger.log('childSnapshot.key:' + msg.key);
        // this.logger.log('childSnapshot.uid:' + msg.uid);
        this.addReplaceMessageInArray(msg.uid, msg);
        // this.updateMessageStatusReceived(msg);
        this.messageAdded.next(msg);
    }

    /** */
    private changed(patch: any) {
        // const msg = this.chat21HttpService.messageGenerate(message);
        let isInfoMessage = messageType(MESSAGE_TYPE_INFO, patch)
        if(isInfoMessage ){
            return;
        }
        this.logger.log('[MQTTConversationHandler] updating message with patch', patch);
        const index = searchIndexInArrayForUid(this.messages, patch.message_id);
        if (index > -1) {
            const message = this.messages[index];
            if (message) {
                message.status = patch.status;
                this.logger.log('[MQTTConversationHandler] message found and patched (replacing)', message);
                this.addReplaceMessageInArray(message.uid, message);
                this.messageChanged.next(message);
            }
        }
    }

    /** */
    private removed(childSnapshot: any) {
        const index = searchIndexInArrayForUid(this.messages, childSnapshot.key);
        // controllo superfluo sarà sempre maggiore
        if (index > -1) {
            this.messages.splice(index, 1);
            this.messageRemoved.next(childSnapshot.key);
        }
    }

    /** */
    // private messageGenerate(childSnapshot: any) {
    //     // const msg: MessageModel = childSnapshot.val();
    //     this.logger.log("[MQTTConversationHandler] childSnapshot >" + JSON.stringify(childSnapshot));
    //     const msg = childSnapshot;
    //     msg.uid = childSnapshot.key;
    //     msg.text = msg.text.trim() //remove black msg with only spaces
    //     // controllo fatto per i gruppi da rifattorizzare
    //     if (!msg.sender_fullname || msg.sender_fullname === 'undefined') {
    //         msg.sender_fullname = msg.sender;
    //     }
    //     // bonifico messaggio da url
    //     // if (msg.type === 'text') {
    //     //     msg.text = htmlEntities(msg.text);
    //     // }
    //     // verifico che il sender è il logged user
    //     this.logger.log("[MQTTConversationHandler] ****>msg.sender:" + msg.sender);
    //     msg.isSender = this.isSender(msg.sender, this.loggedUser.uid);
    //     // traduco messaggi se sono del server
    //     if (msg.attributes && msg.attributes.subtype) {
    //         if (msg.attributes.subtype === 'info' || msg.attributes.subtype === 'info/support') {
    //             this.translateInfoSupportMessages(msg);
    //         }
    //     }
    //     return msg;
    // }

    /** */
    private addReplaceMessageInArray(uid: string, msg: MessageModel) {
        const index = searchIndexInArrayForUid(this.chat21HttpService.messages[this.conversationWith], uid);
        if (index > -1) {
            // const headerDate = this.messages[index].headerDate;
            // msg.headerDate = headerDate;
            this.messages.splice(index, 1, msg);
        } else {
            this.messages.splice(0, 0, msg);
        }
        this.messages.sort(compareValues('timestamp', 'asc'));
        this.updateMessageStatusReceived(msg);
    }

    /** */
    // private translateInfoSupportMessages(message: MessageModel) {
    //     // check if the message attributes has parameters and it is of the "MEMBER_JOINED_GROUP" type
    //     const INFO_SUPPORT_USER_ADDED_SUBJECT = this.translationMap.get('INFO_SUPPORT_USER_ADDED_SUBJECT');
    //     const INFO_SUPPORT_USER_ADDED_YOU_VERB = this.translationMap.get('INFO_SUPPORT_USER_ADDED_YOU_VERB');
    //     const INFO_SUPPORT_USER_ADDED_COMPLEMENT = this.translationMap.get('INFO_SUPPORT_USER_ADDED_COMPLEMENT');
    //     const INFO_SUPPORT_USER_ADDED_VERB = this.translationMap.get('INFO_SUPPORT_USER_ADDED_VERB');
    //     const INFO_SUPPORT_CHAT_REOPENED = this.translationMap.get('INFO_SUPPORT_CHAT_REOPENED');
    //     const INFO_SUPPORT_CHAT_CLOSED = this.translationMap.get('INFO_SUPPORT_CHAT_CLOSED');
    //     if (message.attributes.messagelabel
    //         && message.attributes.messagelabel.parameters
    //         && message.attributes.messagelabel.key === MEMBER_JOINED_GROUP
    //     ) {
    //         let subject: string;
    //         let verb: string;
    //         let complement: string;
    //         if (message.attributes.messagelabel.parameters.member_id === this.loggedUser.uid) {
    //             subject = INFO_SUPPORT_USER_ADDED_SUBJECT;
    //             verb = INFO_SUPPORT_USER_ADDED_YOU_VERB;
    //             complement = INFO_SUPPORT_USER_ADDED_COMPLEMENT;
    //         } else {
    //             if (message.attributes.messagelabel.parameters.fullname) {
    //                 // other user has been added to the group (and he has a fullname)
    //                 subject = message.attributes.messagelabel.parameters.fullname;
    //                 verb = INFO_SUPPORT_USER_ADDED_VERB;
    //                 complement = INFO_SUPPORT_USER_ADDED_COMPLEMENT;
    //             } else {
    //                 // other user has been added to the group (and he has not a fullname, so use hes useruid)
    //                 subject = message.attributes.messagelabel.parameters.member_id;
    //                 verb = INFO_SUPPORT_USER_ADDED_VERB;
    //                 complement = INFO_SUPPORT_USER_ADDED_COMPLEMENT;
    //             }
    //         }
    //         message.text = subject + ' ' + verb + ' ' + complement;
    //     } else if ((message.attributes.messagelabel && message.attributes.messagelabel.key === CHAT_REOPENED)) {
    //         message.text = INFO_SUPPORT_CHAT_REOPENED;
    //     } else if ((message.attributes.messagelabel && message.attributes.messagelabel.key === CHAT_CLOSED)) {
    //         message.text = INFO_SUPPORT_CHAT_CLOSED;
    //     }
    // }


    /**
     * aggiorno lo stato del messaggio
     * questo stato indica che è stato consegnato al client e NON che è stato letto
     * se il messaggio NON è stato inviato da loggedUser AGGIORNO stato a 200
     * @param item
     * @param conversationWith
     */
    private updateMessageStatusReceived(msg) {
        this.logger.log('[MQTTConversationHandler] updateMessageStatusReceived', msg);
        if (msg['status'] < MSG_STATUS_RECEIVED) {
            this.logger.log('[MQTTConversationHandler] status ', msg['status'], ' < (RECEIVED:200)', MSG_STATUS_RECEIVED);
            if (msg.sender !== this.loggedUser.uid && msg.status < MSG_STATUS_RECEIVED) {
                this.logger.log('[MQTTConversationHandler] updating message with status received');
                this.chat21HttpService.chatClient.updateMessageStatus(msg.message_id, this.conversationWith, MSG_STATUS_RECEIVED, null);
            }
        }
    }

    /**
     * controllo se il messaggio è stato inviato da loggerUser
     * richiamato dalla pagina elenco messaggi della conversazione
     */
    // private isSender(sender: string, currentUserId: string) {
    //     if (currentUserId) {
    //         if (sender === currentUserId) {
    //             return true;
    //         } else {
    //             return false;
    //         }
    //     } else {
    //         return false;
    //     }
    // }


    /** */
    // updateMetadataMessage(uid: string, metadata: any) {
    //     metadata.status = true;
    //     const message = {
    //         metadata: metadata
    //     };
    //     const firebaseMessages = firebase.database().ref(this.urlNodeFirebase + uid);
    //     firebaseMessages.set(message);
    // }


    unsubscribe(key: string) {
        this.logger.log('[MQTTConversationHandler] unsubscribe: ', key);
        this.listSubsriptions.forEach(sub => {
            this.logger.log('[MQTTConversationHandler] unsubscribe: ', sub.uid, key);
            if (sub.uid === key) {
            sub.unsubscribe(key, null);
            return;
            }
        });
    }


    private addCommandMessage(msg: MessageModel){
        const that = this;
        const commands = msg.attributes.commands;
        let i=0;
        function execute(command){
            if(command.type === "message"){
                that.logger.debug('[FIREBASEConversationHandlerSERVICE] addCommandMessage --> type="message"', command, i)
                if (i >= 2) {
                    
                    //check if previus wait message type has time value, otherwize set to 1000ms
                    !commands[i-1].time? commands[i-1].time= 1000 : commands[i-1].time
                    command.message.timestamp = commands[i-2].message.timestamp + commands[i-1].time;
                    
                    /** CHECK IF MESSAGE IS JUST RECEIVED: IF false, set next message time (if object exist) to 0 -> this allow to show it immediately */
                    if(!isJustRecived(that.startTime.getTime(), msg.timestamp)){
                        let previewsTimeMsg = msg.timestamp;
                        commands[i-2]? previewsTimeMsg = commands[i-2].message.timestamp : null;
                        command.message.timestamp = previewsTimeMsg + 100
                        commands[i+1]? commands[i+1].time = 0 : null
                    }
                } else { /**MANAGE FIRST MESSAGE */
                    command.message.timestamp = msg.timestamp;
                    if(!isJustRecived(that.startTime.getTime(), msg.timestamp)){
                        commands[i+1]? commands[i+1].time = 0 : null
                    }
                }
                that.generateMessageObject(msg, command.message, function () {
                    i += 1
                    if (i < commands.length) {
                        execute(commands[i])
                    }
                    else {
                        that.logger.debug('[FIREBASEConversationHandlerSERVICE] addCommandMessage --> last command executed (wait), exit') 
                    }
                })
            }else if(command.type === "wait"){
                that.logger.debug('[FIREBASEConversationHandlerSERVICE] addCommandMessage --> type="wait"', command, i, commands.length)
                //publish waiting event to simulate user typing
                if(isJustRecived(that.startTime.getTime(), msg.timestamp)){
                    // console.log('message just received::', command, i, commands)
                    that.messageWait.next({uid: that.conversationWith, uidUserTypingNow: msg.sender, nameUserTypingNow: msg.sender_fullname, waitTime: command.time, command: command})
                }
                setTimeout(function() {
                    i += 1
                    if (i < commands.length) {
                        execute(commands[i])
                    }
                    else {
                        that.logger.debug('[FIREBASEConversationHandlerSERVICE] addCommandMessage --> last command executed (send message), exit') 
                    }
                },command.time)
            }
        }
        execute(commands[0]) //START render first message
    }

    private generateMessageObject(message, command_message, callback) {
        let parentUid = message.uid
        command_message.uid = uuidv4();
        command_message.text = command_message.text.trim() //remove black msg with only spaces
        command_message.language = message.language;
        command_message.recipient = message.recipient;
        command_message.recipient_fullname = message.recipient_fullname;
        command_message.sender = message.sender;
        command_message.sender_fullname = message.sender_fullname;
        command_message.channel_type = message.channel_type;
        command_message.status = message.status;
        command_message.isSender = message.isSender;
        command_message.attributes? command_message.attributes.commands = true : command_message.attributes = {commands : true}
        command_message.attributes.parentUid = parentUid //added to manage message STATUS UPDATES
        this.added(command_message)
        callback();
    }

}
