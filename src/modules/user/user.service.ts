import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
import { requireAdminRole } from '../../utils/require-admin-role';
import { Role } from '../../db/entities/role.entity';
import { User } from '../../db/entities/user.entity';
import { CreateUserDto } from './userDto/create-user.dto';
import { UpdateProfileDto } from './userDto/update-profile.dto';
import { UpdateUserDto } from './userDto/update-user.dto';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
  ) {}
  async getAllUsers(createdByUserId: number): Promise<User[]> {
    return this.userRepository.find({
      where: { createdBy: { id: createdByUserId } },
      relations: ['role'],
    });
  }

  async getOwnProfile(userId: number): Promise<User> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      relations: ['role'],
    });

    if (!user) {
      throw new NotFoundException('User not found.');
    }

    return user;
  }

  async updateOwnProfile(
    userId: number,
    updateProfileDto: UpdateProfileDto,
  ): Promise<User> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      relations: ['role'],
    });

    if (!user) {
      throw new NotFoundException('User not found.');
    }

    const { email, phone, name } = updateProfileDto;

    if (email !== undefined && email.trim() !== user.email) {
      const existingByEmail = await this.userRepository.findOne({
        where: { email: email.trim() },
      });
      if (existingByEmail && existingByEmail.id !== userId) {
        throw new ConflictException('An account with this email already exists.');
      }
      user.email = email.trim();
    }

    if (name !== undefined) {
      user.name = name.trim();
    }

    if (phone !== undefined) {
      const trimmedPhone = phone.trim();
      user.phone = trimmedPhone.length > 0 ? trimmedPhone : null;
    }

    return this.userRepository.save(user);
  }
  async createUser(createUserDto: CreateUserDto, user: User): Promise<User> {
    const { email, password, phone, name, role: roleName } = createUserDto;
  
    requireAdminRole(user, 'You do not have permission to create a user.');
  
    const existingByEmail = await this.userRepository.findOne({
      where: { email },
    });
  
    if (existingByEmail) {
      throw new ConflictException('An account with this email already exists.');
    }
  
    const role = await this.roleRepository.findOne({
      where: { name: roleName },
    });
  
    if (!role) {
      throw new NotFoundException(`Role '${roleName}' does not exist.`);
    }
  
    const passwordHash = await bcrypt.hash(password, 10);
  
    const newUser = this.userRepository.create({
      email,
      name,
      phone,
      passwordHash,
      role,
      createdBy: user,
    });
  
    await this.userRepository.save(newUser);
  
    return newUser;
  }

  async deleteUser(id: number): Promise<User> {
    const user = await this.userRepository.findOne({ where: { id } });

    if (!user) {
      throw new NotFoundException(`User with id ${id} not found.`);
    }

    await this.userRepository.delete(id);
    return user;
  }

  async deactivateUser(id: number, user: User): Promise<User> {
    requireAdminRole(
      user,
      'You do not have permission to deactivate this user.',
    );

    const targetUser = await this.userRepository.findOne({ where: { id } });
    if (!targetUser) {
      throw new NotFoundException(`User with id ${id} not found.`);
    }

    if (!targetUser.isActive) {
      throw new ConflictException('User is already deactivated.');
    }

    targetUser.isActive = false;
    await this.userRepository.save(targetUser);

    return targetUser;
  }
  async activateUser(id: number, user: User): Promise<User> {
    requireAdminRole(user, 'You do not have permission to activate this user.');

    const targetUser = await this.userRepository.findOne({ where: { id } });
    if (!targetUser) {
      throw new NotFoundException(`User with id ${id} not found.`);
    }

    if (targetUser.isActive) {
      throw new ConflictException('User is already activated.');
    }

    targetUser.isActive = true;
    await this.userRepository.save(targetUser);

    return targetUser;
  }
  async updateUser(
    id: number,
    updateUserDto: UpdateUserDto,
    user: User,
  ): Promise<User> {
    requireAdminRole(user, 'You do not have permission to update this user.');
  
    const targetUser = await this.userRepository.findOne({
      where: { id },
      relations: ['role'],
    });
  
    if (!targetUser) {
      throw new NotFoundException(`User with id ${id} not found.`);
    }
  
    const { email, phone, name, role: roleName } = updateUserDto;
  
    if (email !== undefined) targetUser.email = email;
    if (phone !== undefined) targetUser.phone = phone;
    if (name !== undefined) targetUser.name = name;
  
    if (roleName !== undefined) {
      const roleEntity = await this.roleRepository.findOne({
        where: { name: roleName },
      });
  
      if (!roleEntity) {
        throw new NotFoundException(`Role '${roleName}' does not exist.`);
      }
  
      targetUser.role = roleEntity;
    }
  
    return this.userRepository.save(targetUser);
  }
}
