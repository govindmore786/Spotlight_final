const express = require('express');
const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const fs = require('fs');
require('dotenv').config(); // Load environment variables
const path = require("path") ;
const app = express();
const saltRounds = 10; // Salt rounds for password hashing

// Configure Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUD_NAME,
    api_key: process.env.API_KEY,
    api_secret: process.env.API_SECRET,
});

// MongoDB Connection
mongoose
    .connect(
        `mongodb+srv://${process.env.USER_NAME}:${process.env.PASS}@veer.jleyd.mongodb.net/your-database-name?retryWrites=true&w=majority`,
        { useNewUrlParser: true, useUnifiedTopology: true }
    )
    .then(() => console.log('Connected to MongoDB'))
    .catch((err) => console.error('MongoDB connection error:', err));

// Define User Schema and Model for Authentication
const UserSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    address: { type: String, required: true },
});

const User = mongoose.model('User', UserSchema);

// Define Review Schema and Model
const reviewSchema = new mongoose.Schema({
    content: { type: String, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    userName: { type: String, required: true }, // Store the user's name
    imageUrl: [{ type: String }],
    videoUrl: [{ type: String }],
}, { timestamps: true });

const Review = mongoose.model("Review", reviewSchema);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static("build"));
// Temporary storage for file uploads
const storage = multer.memoryStorage(); // Store in memory for Cloudinary
const upload = multer({ storage });

// Signup Route
app.post('/signup', async (req, res) => {
    const { name, email, password, address } = req.body;

    try {
        // Check if user already exists
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ success: false, message: 'Email already in use.' });
        }

        // Hash the password
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        // Create a new user
        const newUser = new User({
            name,
            email,
            password: hashedPassword,
            address,
        });

        await newUser.save();
        res.status(201).json({ success: true, message: 'User registered successfully.' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Signup failed.', error: error.message });
    }
});

// Signin Route
app.post('/signin', async (req, res) => {
    try {
        const { email, password } = req.body;

        // Check if email and password are provided
        if (!email || !password) {
            return res.status(400).json({ success: false, message: 'Email and password are required.' });
        }

        // Check if user exists
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(400).json({ success: false, message: 'Invalid email or password.' });
        }

        // Verify the password
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(400).json({ success: false, message: 'Invalid email or password.' });
        }

        // Generate a JWT
        const token = jwt.sign(
            { id: user._id, email: user.email },
            process.env.JWT_SECRET,
            { expiresIn: '1h' }
        );

        res.status(200).json({
            success: true,
            message: 'Sign In Successful!',
            token,
            user: { 
                id: user._id, // Include user ID
                name: user.name, 
                email: user.email, 
                address: user.address 
            },
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Sign In failed.', error: error.message });
    }
});

// Upload Review Route
app.post("/upload", upload.fields([
    { name: "images", maxCount: 10 },
    { name: "videos", maxCount: 10 }
]), async (req, res) => {
    const { content, userId } = req.body;
    let imageUrls = [];
    let videoUrls = [];

    if (!userId) {
        return res.status(400).json({ success: false, message: "userId is required." });
    }

    try {
        // Fetch user name
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ success: false, message: "User not found." });
        }

        // Upload images
        if (req.files["images"]) {
            for (const file of req.files["images"]) {
                const result = await new Promise((resolve, reject) => {
                    cloudinary.uploader.upload_stream({ resource_type: "image" }, (error, result) => {
                        if (error) return reject(error);
                        resolve(result);
                    }).end(file.buffer);
                });
                imageUrls.push(result.secure_url);
            }
        }

        // Upload videos
        if (req.files["videos"]) {
            for (const file of req.files["videos"]) {
                const result = await new Promise((resolve, reject) => {
                    cloudinary.uploader.upload_stream({ resource_type: "video" }, (error, result) => {
                        if (error) return reject(error);
                        resolve(result);
                    }).end(file.buffer);
                });
                videoUrls.push(result.secure_url);
            }
        }

        // Create and save the review
        const newReview = new Review({
            content,
            userId, // Store the user's ID
            userName: user.name, // Store the user's name
            imageUrl: imageUrls,
            videoUrl: videoUrls,
        });

        await newReview.save();
        res.status(201).json({ success: true, message: "Review uploaded successfully.", review: newReview });
    } catch (error) {
        res.status(500).json({ success: false, message: "Error uploading review.", error: error.message });
    }
});

// Route to display all reviews
app.get("/display", async (req, res) => {
    try {
        const reviews = await Review.find().populate("userId", "name email");
        res.json(reviews);
    } catch (err) {
        res.status(500).json({ message: "Failed to retrieve reviews", error: err.message });
    }
});

// Start the server
app.listen(5000, () => {
    console.log('Server running on port 5000');
});