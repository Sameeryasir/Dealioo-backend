import { IsNotEmpty, IsNumber, IsString } from "class-validator";

export class CreateMenuDto {
  @IsNumber()
  @IsNotEmpty()
  restaurantId: number;

  @IsString()
  @IsNotEmpty()
  fileUrl: string;
}