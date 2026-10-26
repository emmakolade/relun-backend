// Common API response types
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: Pagination;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

// Auth request/response types
export interface RequestOTPRequest {
  email?: string;
  phone?: string;
}

export interface RequestOTPResponse {
  message: string;
  isNewUser: boolean;
}

export interface VerifyOTPRequest {
  email?: string;
  phone?: string;
  otp: string;
}

export interface VerifyOTPResponse {
  message: string;
  verified: boolean;
}

export interface LoginRequest {
  email?: string;
  phone?: string;
}

export interface UserProfile {
  bio?: string;
  city?: string;
  segment?: string;
  isComplete?: boolean;
  completenessScore?: number;
}

export interface AuthUserResponse {
  id: string;
  email?: string;
  phone?: string;
  fullName?: string;
  dateOfBirth?: Date;
  gender?: 'male' | 'female';
  isActive: boolean;
  isEmailVerified: boolean;
  isPhoneVerified: boolean;
  lastActive?: Date;
  profile?: UserProfile;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: AuthUserResponse;
  needsProfileCompletion: boolean;
  needsEmail: boolean;
  needsPhone: boolean;
}

export interface RefreshTokenRequest {
  refreshToken: string;
}

export interface RefreshTokenResponse {
  accessToken: string;
  refreshToken: string;
}

// Profile request/response types
export interface CompleteProfileRequest {
  fullName?: string;
  dateOfBirth?: string;
  gender?: 'male' | 'female';
  bio?: string;
  segment?: string;
  showMe?: 'opposite' | 'everyone';
  email?: string;
  phone?: string;
  latitude?: number;
  longitude?: number;
}

export interface ProfileUpdateData {
  fullName?: string;
  dateOfBirth?: string;
  gender?: 'male' | 'female';
  email?: string;
  phone?: string;
  bio?: string;
  segment?: string;
  showMe?: 'opposite' | 'everyone';
  latitude?: number;
  longitude?: number;
  location?: {
    type: string;
    coordinates: number[];
  };
  occupation?: string;
  education?: string;
  company?: string;
  school?: string;
  city?: string;
  state?: string;
  country?: string;
  height?: number;
  bodyType?: string;
  ethnicity?: string;
  drinking?: string;
  smoking?: string;
  religion?: string;
  politicalViews?: string;
  lookingFor?: string;
  interests?: string[];
  isVisible?: boolean;
  showAge?: boolean;
  showDistance?: boolean;
}

export interface UpdateProfileRequest {
  fullName?: string;
  dateOfBirth?: string;
  gender?: 'male' | 'female';
  bio?: string;
  occupation?: string;
  education?: string;
  company?: string;
  school?: string;
  city?: string;
  state?: string;
  country?: string;
  height?: number;
  bodyType?: string;
  ethnicity?: string;
  drinking?: string;
  smoking?: string;
  religion?: string;
  politicalViews?: string;
  lookingFor?: string;
  interests?: string[];
  segment?: string;
  isVisible?: boolean;
  showAge?: boolean;
  showDistance?: boolean;
}

export interface UpdateLocationRequest {
  latitude: number;
  longitude: number;
}

// Chat request/response types
export interface GetMessagesResponse {
  messages: import('./user.types').Message[];
  pagination: Pagination;
  // Set while the two are talking through a message request rather than a match.
  request?: import('../services/messageRequest.service').MessageRequestView | null;
}

export interface GetConversationsResponse {
  conversations: import('./user.types').Conversation[];
  pagination: Pagination;
}

export interface SendMessageRequest {
  content: string;
  messageType?: 'text' | 'image' | 'video' | 'audio';
  // Optional id chosen by the app, echoed back on new_message and error.
  clientId?: string;
}

export interface UnreadCountResponse {
  unreadCount: number;
}

// Socket event types
export interface SocketSendMessageData {
  recipientId: string;
  content: string;
  messageType?: 'text' | 'image' | 'video' | 'audio';
  // Optional id chosen by the app, echoed back on new_message and error.
  clientId?: string;
}

export interface SocketTypingData {
  recipientId: string;
  isTyping: boolean;
}

export interface SocketMarkReadData {
  recipientId: string;
}

export interface SocketNewMessageEvent {
  conversationId: string;
  message: import('./user.types').Message;
  clientId?: string;
}

export interface SocketUserTypingEvent {
  userId: string;
  isTyping: boolean;
}

export interface SocketMessagesReadEvent {
  conversationId: string;
  readBy: string;
}

export interface SocketPresenceEvent {
  userId: string;
  isOnline: boolean;
}
