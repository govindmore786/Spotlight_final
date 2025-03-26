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
app.use(cors({origin:"*"}));
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
app.post(
    "/upload",
    upload.fields([
      { name: "images", maxCount: 10 },
      { name: "videos", maxCount: 10 },
    ]),
    async (req, res) => {
      console.log("Files received:", req.files);
  
      let { content, userId } = req.body;
  
      // Ensure userId is not null, undefined, or an invalid string
      if (!userId || userId === "null" || userId === "undefined") {
        return res.status(400).json({ success: false, message: "Valid userId is required." });
      }
  
      try {
        // Convert userId to a valid ObjectId (if it's a string)
        if (typeof userId === "string") {
          const mongoose = require("mongoose");
          if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({ success: false, message: "Invalid userId format." });
          }
        }
  
        // Fetch user details
        const user = await User.findById(userId);
        if (!user) {
          return res.status(404).json({ success: false, message: "User not found." });
        }
  
        const uploadToCloudinary = (buffer, resourceType) => {
          return new Promise((resolve, reject) => {
            const stream = cloudinary.uploader.upload_stream(
              { resource_type: resourceType },
              (error, result) => {
                if (error) {
                  console.error("Cloudinary Upload Error:", error);
                  return reject(error);
                }
                resolve(result.secure_url);
              }
            );
            stream.end(buffer);
          });
        };
  
        // Upload images
        const imageUploads = req.files["images"]
          ? req.files["images"].map((file) => uploadToCloudinary(file.buffer, "image"))
          : [];
  
        // Upload videos
        const videoUploads = req.files["videos"]
          ? req.files["videos"].map((file) => uploadToCloudinary(file.buffer, "video"))
          : [];
  
        // Execute all uploads in parallel
        const imageUrls = await Promise.all(imageUploads);
        const videoUrls = await Promise.all(videoUploads);
  
        // Create and save the review
        const newReview = new Review({
          content,
          userId,
          userName: user.name,
          imageUrl: imageUrls,
          videoUrl: videoUrls,
        });
  
        await newReview.save();
  
        res.status(201).json({
          success: true,
          message: "Review uploaded successfully.",
          review: newReview,
        });
      } catch (error) {
        console.error("Upload Error:", error);
        res.status(500).json({ success: false, message: "Error uploading review.", error: error.message });
      }
    }
  );
  
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