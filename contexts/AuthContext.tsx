import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import { Platform } from 'react-native';

import {
  getAuth,
  signInWithPhoneNumber,
  signOut
} from '@react-native-firebase/auth';
import { router } from 'expo-router';
import { apiService } from '@/api/api';

export enum UserRole {
  CUSTOMER = 'customer',

}



export interface User {
  id: string;
  phone: string;
  role: UserRole;
  customerType: UserRole;
  franchiseId?: string;
  franchiseName?: string;
  permissions: string[];
  hasOnboarded: boolean;
  name: string;
  email?: string;
  avatar?: string;
  address?: string;
  alternativePhone?: string

}

export interface ViewAsState {
  isViewingAs: boolean;
  originalUser: User | null;
  currentViewRole: UserRole | null;
  targetFranchiseId?: string;
  targetUserId?: string;
  targetFranchiseName?: string;
  targetUserName?: string;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  viewAsState: ViewAsState;

  // Auth methods
  sendOTP: (phoneNumber: string, customerType: UserRole) => Promise<any>;
  verifyOTP: (otp: string, role: string) => Promise<{
    nextScreen: string;
    success: boolean;
  }>;
  logout: () => Promise<void>;



  // Refresh user data
  refreshUser: () => Promise<void>;
  setUser: (user: User) => void
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [confirmation, setConfirmation] = useState<any>(null);
  const [viewAsState, setViewAsState] = useState<ViewAsState>({
    isViewingAs: false,
    originalUser: null,
    currentViewRole: null,
  });

  const isAuthenticated = !!user;

  useEffect(() => {
    initializeAuth();
  }, []);

  const initializeAuth = async () => {
    try {
      const [accessToken, userProfile, viewAsData] = await AsyncStorage.multiGet([
        'accessToken',
        'userProfile',
        'viewAsState'
      ]);

      if (accessToken[1] && userProfile[1]) {
        const parsedUser = JSON.parse(userProfile[1]);
        setUser(parsedUser);

        if (viewAsData[1]) {
          const parsedViewAs = JSON.parse(viewAsData[1]);
          setViewAsState(parsedViewAs);
        }

        // Validate token with backend
        try {
          await refreshUser();
        } catch (error) {
          // If refresh fails during initialization, clear everything
          console.log('Token validation failed during initialization');
          await clearAuthData();
          setUser(null);
          setViewAsState({
            isViewingAs: false,
            originalUser: null,
            currentViewRole: null,
          });
        }
      }
    } catch (error) {
      console.log('Auth initialization error:', error);
      await clearAuthData();
    } finally {
      setIsLoading(false);
    }
  };

  const sendOTP = async (phoneNumber: string, customerType: UserRole): Promise<any> => {
    try {
      console.log('=== Starting OTP Process ===');
      console.log('Phone number:', phoneNumber);
      console.log('Customer type:', customerType);
      console.log('Platform:', Platform.OS);

      const formattedPhone = '+91' + phoneNumber.replace(/\D/g, '');
      console.log('Formatted phone:', formattedPhone);




      const confirmation = await signInWithPhoneNumber(getAuth(), formattedPhone);
      console.log('=== OTP Sent Successfully ===');
      setConfirmation(confirmation);
      return confirmation;

    } catch (error) {
      console.log('=== OTP Error ===');
      console.log('Error details:', error);
      throw error;
    }
  };

  const verifyOTP = async (otp: string, role: string): Promise<{
    nextScreen: string;
    success: boolean;
  }> => {
    try {
      setIsLoading(true);
      if (!confirmation) {
        throw new Error('No OTP confirmation found. Please request a new OTP.');
      }

      // Verify OTP
      const result = await confirmation.confirm(otp);
      const idToken = await result.user.getIdToken();

      console.log('OTP verification successful, sending to backend...');

      // Send idToken and role to backend for authentication
      const response = await apiService.post('/auth/login', {
        idToken,
        role: 'customer' // Send the role that was selected during login
      });

      console.log('Backend login response:', response);

      if (response.success) {
        const { accessToken, refreshToken, user: userData } = response.data;

        console.log('userData', userData);

        // Store tokens and user data
        await AsyncStorage.multiSet([
          ['accessToken', accessToken],
          ['refreshToken', refreshToken],
          ['userProfile', JSON.stringify(userData)],
        ]);

        setUser(userData);
        setConfirmation(null); // Clear confirmation after successful verification

        let nextScreen = userData ? '/intialscreen' : '/';

        return {
          nextScreen: nextScreen,
          success: true,
        };
      } else {
        throw new Error(response.error || 'Login failed');
      }
    } catch (error: any) {
      console.log('Verify OTP error:', error);

      // Clear confirmation on error so user can try again
      setConfirmation(null);

      // Re-throw with a user-friendly message
      if (error.code === 'auth/invalid-verification-code') {
        throw new Error('Invalid OTP. Please check the code and try again.');
      } else if (error.code === 'auth/code-expired') {
        throw new Error('OTP has expired. Please request a new code.');
      } else {
        throw new Error(error.message || 'OTP verification failed. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    try {
      setIsLoading(true);


      await signOut(getAuth());


      // Clear local storage
      await clearAuthData();

      // Reset state
      setUser(null);
      setConfirmation(null);
      setViewAsState({
        isViewingAs: false,
        originalUser: null,
        currentViewRole: null,
      });
    } catch (error) {
      console.log('Logout error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const clearAuthData = async () => {
    await AsyncStorage.multiRemove([
      'accessToken',
      'refreshToken',
      'userProfile',
      'viewAsState'
    ]);
  };




  const refreshUser = async () => {
    try {
      const response = await apiService.get('/auth/me');
      console.log('response in refreshuser ', response);
      if (response.success) {
        // Only update if not in view-as mode

        setUser({
          ...response.data.user,
          hasOnboarded: response.data.user.hasOnboarded,
        });
        // todo
        if (response.data.user) {
          router.replace('/intialscreen');
        } else {
          router.replace('/(auth)');
        }

      } else {
        router.replace('/(auth)');
        // Handle non-success response
        throw new Error('Failed to refresh user data');

      }
    } catch (error: any) {
      console.log('Refresh user error:', error);

      // Clear auth data immediately when refresh fails
      await clearAuthData();
      setUser(null);
      setViewAsState({
        isViewingAs: false,
        originalUser: null,
        currentViewRole: null,
      });

      // Then redirect to auth screen
      router.replace('/(auth)');
    }
  };



  const value: AuthContextType = {
    user,
    isLoading,
    isAuthenticated,
    viewAsState,
    sendOTP,
    verifyOTP,
    logout,
    refreshUser,
    setUser
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};