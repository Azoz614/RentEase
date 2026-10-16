import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
    username : {
        type: String,
        required: true,
        unique: true,
        trim : true
    },
    email : {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim : true
    },
    phone: {
        type: String,
        required: true,
        trim: true
    },
    password : {
        type : String,
        required : true,
        minlength : 10
    },
    role: { type: String, enum: ['user', 'delivery_partner', 'rental_shop', 'admin'], default: 'user', index: true },
    shopName: { type: String, trim: true, default: '' },
    shopStatus: { type: String, enum: ['not_applicable', 'pending', 'approved', 'rejected'], default: 'not_applicable', index: true },
    active: { type: Boolean, default: true, index: true },
    defaultAddress: { type: String, trim: true, default: '' },
    nic: { type: String, uppercase: true, trim: true, default: '' },
    addressLocation: { latitude: Number, longitude: Number },
    wishlist: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
    loyaltyPoints: { type: Number, default: 0, min: 0 },
    trustScore: { type: Number, default: 50, min: 0, max: 100 },
    identityStatus: { type: String, enum: ['not_submitted', 'pending', 'approved', 'rejected'], default: 'not_submitted', index: true },
    identityFrontPath: { type: String, default: '' },
    identityBackPath: { type: String, default: '' },
    identitySubmittedAt: { type: Date },
    identityReviewNote: { type: String, maxlength: 500, default: '' },
},{timestamps : true}
);


export const User = mongoose.model('User', userSchema);
