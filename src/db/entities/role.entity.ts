import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from 'typeorm';
import type { BusinessMember } from './business-member.entity';
import type { User } from './user.entity';
@Entity('roles')
export class Role {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', unique: true })
  name: string;

  @OneToMany(() => require('./user.entity').User, (user) => user.role)
  users: User[];

  @OneToMany(() => require('./business-member.entity').BusinessMember, (member) => member.memberRole)
  businessMembers: BusinessMember[];
}
