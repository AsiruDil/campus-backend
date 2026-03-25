import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema({
    sender: String, 
    recipients: [String], 
    subject: String,
    message: String,
    date: { type: Date, default: Date.now }
});

const Message = mongoose.model('Message', messageSchema);
export default Message;