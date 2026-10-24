import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import {
  createUploadSchema,
  parseBody,
  signPartsSchema,
  type SignedPartsView,
  type UploadStatusView,
  type UploadView,
} from './uploads.dto';
import { UploadsService } from './uploads.service';

@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Post()
  create(@Body() body: unknown): Promise<UploadView> {
    return this.uploads.create(parseBody(createUploadSchema, body));
  }

  @Get(':id')
  status(@Param('id', ParseUUIDPipe) id: string): Promise<UploadStatusView> {
    return this.uploads.status(id);
  }

  @Post(':id/parts')
  @HttpCode(200)
  signParts(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown): Promise<SignedPartsView> {
    return this.uploads.signParts(id, parseBody(signPartsSchema, body));
  }

  @Post(':id/complete')
  @HttpCode(200)
  complete(@Param('id', ParseUUIDPipe) id: string): Promise<UploadView> {
    return this.uploads.complete(id);
  }

  @Delete(':id')
  @HttpCode(204)
  abort(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.uploads.abort(id);
  }
}
