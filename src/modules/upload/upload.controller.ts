import {
  BadRequestException,
  Controller,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { createMemoryFileUploadMulterOptions } from '../../utils/disk-file-upload-multer';
import { SpacesService } from '../spaces/spaces.service';

@Controller('upload')
export class UploadController {
  constructor(private readonly spacesService: SpacesService) {}

  @UseGuards(AuthGuard('jwt'))
  @Post()
  @UseInterceptors(
    FileInterceptor('file', createMemoryFileUploadMulterOptions()),
  )
  async upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Query('folder') folder?: string,
  ) {
    if (!file) {
      throw new BadRequestException('File is required.');
    }

    const targetFolder = folder?.trim() || 'uploads';
    const url = await this.spacesService.uploadFile(file, targetFolder);

    return {
      success: true,
      url,
    };
  }
}
