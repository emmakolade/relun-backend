import dotenv from 'dotenv';
import { connectDB, closeDB } from '../config/database';
import { User } from '../models/User';
import { Profile } from '../models/Profile';

dotenv.config();

// Sample data pools
const firstNames = {
  male: ['Chukwuemeka', 'Oluwaseun', 'Ademola', 'Ebuka', 'Tunde', 'Chibueze', 'Adeola', 'Bolaji', 'Chinedu', 'Femi', 'Ifeanyi', 'Kayode', 'Obinna', 'Segun', 'Uche'],
  female: ['Chioma', 'Funmilayo', 'Adaeze', 'Blessing', 'Ngozi', 'Omotola', 'Amarachi', 'Chiamaka', 'Folake', 'Ifeoma', 'Kemi', 'Nneka', 'Temitope', 'Yetunde', 'Zainab']
};

const lastNames = ['Okafor', 'Adeleke', 'Ibrahim', 'Oladipo', 'Nwachukwu', 'Adebayo', 'Okeke', 'Balogun', 'Eze', 'Okonkwo', 'Udeh', 'Afolayan', 'Babatunde', 'Chukwu', 'Diallo', 'Ojo', 'Musa', 'Olayinka', 'Usman', 'Yusuf'];

const cities = [
  { city: 'Lagos', state: 'Lagos', country: 'Nigeria', lat: 6.5244, lon: 3.3792 },
  { city: 'Abuja', state: 'FCT', country: 'Nigeria', lat: 9.0765, lon: 7.3986 },
  { city: 'Port Harcourt', state: 'Rivers', country: 'Nigeria', lat: 4.8156, lon: 7.0498 },
  { city: 'Ibadan', state: 'Oyo', country: 'Nigeria', lat: 7.3775, lon: 3.9470 },
  { city: 'Kano', state: 'Kano', country: 'Nigeria', lat: 12.0022, lon: 8.5920 },
  { city: 'Benin City', state: 'Edo', country: 'Nigeria', lat: 6.3350, lon: 5.6037 },
  { city: 'Enugu', state: 'Enugu', country: 'Nigeria', lat: 6.5244, lon: 7.5110 },
  { city: 'Kaduna', state: 'Kaduna', country: 'Nigeria', lat: 10.5222, lon: 7.4383 },
  { city: 'Calabar', state: 'Cross River', country: 'Nigeria', lat: 4.9758, lon: 8.3417 },
  { city: 'Owerri', state: 'Imo', country: 'Nigeria', lat: 5.4840, lon: 7.0351 }
];

const occupations = ['Software Engineer', 'Marketing Manager', 'Teacher', 'Doctor', 'Lawyer', 'Designer', 'Entrepreneur', 'Nurse', 'Accountant', 'Architect', 'Chef', 'Writer', 'Photographer', 'Consultant', 'Sales Manager'];

const companies = ['Flutterwave', 'Paystack', 'Andela', 'Interswitch', 'Kuda Bank', 'GTBank', 'Dangote Group', 'Jumia', 'Access Bank', 'Cowrywise'];

const educations = ['Bachelor\'s Degree', 'Master\'s Degree', 'PhD', 'Associate Degree', 'High School'];

const schools = ['University of Lagos', 'University of Ibadan', 'Obafemi Awolowo University', 'University of Nigeria Nsukka', 'Covenant University', 'Ahmadu Bello University', 'University of Benin', 'Lagos Business School', 'Babcock University', 'Federal University of Technology Akure'];

const bodyTypes = ['Athletic', 'Average', 'Slim', 'Curvy', 'Muscular'];

const ethnicities = ['Caucasian', 'African American', 'Hispanic', 'Asian', 'Mixed'];

const drinking = ['Socially', 'Never', 'Regularly', 'Occasionally'];

const smoking = ['Non-smoker', 'Socially', 'Regularly', 'Trying to quit'];

const religions = ['Christian', 'Muslim', 'Jewish', 'Hindu', 'Buddhist', 'Agnostic', 'Atheist', 'Spiritual'];

const politicalViews = ['Liberal', 'Conservative', 'Moderate', 'Apolitical'];

const lookingForOptions = ['Long-term relationship', 'Casual dating', 'Friendship', 'Something casual', 'Not sure yet'];

const interests = [
  'Travel', 'Photography', 'Cooking', 'Fitness', 'Yoga', 'Reading', 'Music', 'Movies',
  'Hiking', 'Gaming', 'Art', 'Dancing', 'Sports', 'Wine tasting', 'Meditation',
  'Running', 'Swimming', 'Cycling', 'Fashion', 'Technology', 'Writing', 'Volunteering',
  'Theater', 'Comedy', 'Coffee', 'Dogs', 'Cats', 'Nature', 'Camping'
];

const bios = [
  'Love to explore new places and try different cuisines. Always up for an adventure!',
  'Fitness enthusiast and coffee lover. Looking for someone to share life\'s moments with.',
  'Passionate about my work and love to unwind with good food and great company.',
  'Enjoying life one day at a time. Let\'s create some memories together!',
  'Book lover and travel addict. Seeking someone who can keep up with my wanderlust.',
  'Living life to the fullest! Love outdoor activities and spontaneous road trips.',
  'Music is my therapy. Looking for someone who appreciates both quiet nights and wild adventures.',
  'Foodie at heart with a passion for cooking. Let me cook for you sometime!',
  'Always learning, always growing. Seeking a partner to share this journey with.',
  'Life is too short for boring conversations. Let\'s talk about everything and nothing.',
  'Adventure seeker with a love for the outdoors. Hiking partner needed!',
  'Creative soul who loves art, music, and meaningful connections.',
  'Optimist looking for someone to laugh with and build something real.',
  'Work hard, play hard. Looking for balance and someone to share it with.',
  'Simple pleasures, deep conversations, and genuine connections are what I value most.'
];

// Helper functions
const randomElement = <T>(array: T[]): T => array[Math.floor(Math.random() * array.length)];

const randomElements = <T>(array: T[], count: number): T[] => {
  const shuffled = [...array].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, count);
};

const randomAge = (min: number, max: number): number => Math.floor(Math.random() * (max - min + 1)) + min;

const generateBirthDate = (age: number): Date => {
  const today = new Date();
  const birthYear = today.getFullYear() - age;
  const birthMonth = Math.floor(Math.random() * 12);
  const birthDay = Math.floor(Math.random() * 28) + 1;
  return new Date(birthYear, birthMonth, birthDay);
};

const generateEmail = (firstName: string, lastName: string, index: number): string => {
  return `${firstName.toLowerCase()}.${lastName.toLowerCase()}${index}@example.com`;
};

const generatePhone = (): string => {
  const prefixes = ['0803', '0805', '0806', '0807', '0808', '0809', '0810', '0812', '0813', '0814', '0816', '0817', '0818', '0902', '0904', '0906', '0907', '0908', '0909', '0912', '0913', '0915', '0916'];
  const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
  const lineNumber = Math.floor(Math.random() * 10000000).toString().padStart(7, '0');
  return `+234${prefix.substring(1)}${lineNumber}`;
};

const createUser = async (index: number) => {
  const gender = Math.random() > 0.5 ? 'male' : 'female';
  const firstName = randomElement(firstNames[gender]);
  const lastName = randomElement(lastNames);
  const age = randomAge(21, 45);
  const location = randomElement(cities);

  // Create user
  const user = await User.create({
    email: generateEmail(firstName, lastName, index),
    phone: generatePhone(),
    fullName: `${firstName} ${lastName}`,
    dateOfBirth: generateBirthDate(age),
    gender,
    isActive: true,
    isEmailVerified: true,
    isPhoneVerified: true,
    lastActive: new Date(),
  });

  // Create profile
  const profile = await Profile.create({
    userId: user._id,
    bio: randomElement(bios),
    occupation: randomElement(occupations),
    education: randomElement(educations),
    company: randomElement(companies),
    school: randomElement(schools),
    city: location.city,
    state: location.state,
    country: location.country,
    latitude: location.lat,
    longitude: location.lon,
    location: {
      type: 'Point',
      coordinates: [location.lon, location.lat],
    },
    height: gender === 'male' ? randomAge(165, 195) : randomAge(155, 180),
    bodyType: randomElement(bodyTypes),
    ethnicity: randomElement(ethnicities),
    drinking: randomElement(drinking),
    smoking: randomElement(smoking),
    religion: randomElement(religions),
    politicalViews: randomElement(politicalViews),
    lookingFor: randomElement(lookingForOptions),
    interests: randomElements(interests, randomAge(5, 10)),
    segment: 'relationship',
    isVisible: true,
    showAge: true,
    showDistance: true,
    isComplete: true,
    completenessScore: 100,
  });

  return { user, profile };
};

const seedUsers = async () => {
  try {
    console.log('🌱 Starting user seeding...');
    
    // Connect to database
    await connectDB();

    // Create 20 users
    console.log('👥 Creating 20 users with completed profiles...');
    const promises = [];
    for (let i = 1; i <= 20; i++) {
      promises.push(createUser(i));
    }

    const results = await Promise.all(promises);

    console.log(`✅ Successfully created ${results.length} users with profiles!`);
    console.log('\nSample users:');
    results.slice(0, 3).forEach((result, index) => {
      console.log(`\n${index + 1}. ${result.user.fullName}`);
      console.log(`   Email: ${result.user.email}`);
      console.log(`   Gender: ${result.user.gender}`);
      console.log(`   Location: ${result.profile.city}, ${result.profile.state}`);
      console.log(`   Occupation: ${result.profile.occupation}`);
      console.log(`   Interests: ${result.profile.interests.slice(0, 3).join(', ')}...`);
    });

    console.log('\n✨ Seeding complete!');
  } catch (error) {
    console.error('❌ Error seeding users:', error);
  } finally {
    await closeDB();
    process.exit(0);
  }
};

// Run the seed script
seedUsers();
