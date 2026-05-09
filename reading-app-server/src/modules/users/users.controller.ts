import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { UsersService } from './users.service';

@Controller('v1/users')
export class UsersController {
  constructor(
    @Inject(UsersService)
    private readonly usersService: UsersService,
  ) {}

  @Post('anonymous')
  createAnonymousUser(@Body() rawBody: string | undefined) {
    const request = this.usersService.parseCreateAnonymousUserRequest(rawBody);
    return this.usersService.createOrRestoreAnonymousUser(request);
  }

  @Get(':userId')
  getUser(@Param('userId') userId: string) {
    return this.usersService.getUser(userId);
  }

  @Post(':userId/documents')
  upsertDocument(
    @Param('userId') userId: string,
    @Body() rawBody: string | undefined,
  ) {
    const request = this.usersService.parseUpsertDocumentRequest(rawBody);
    return this.usersService.upsertDocument(userId, request);
  }

  @Get(':userId/documents')
  listDocuments(@Param('userId') userId: string) {
    return this.usersService.listDocuments(userId);
  }

  @Patch(':userId/documents/:documentId/progress')
  patchProgress(
    @Param('userId') userId: string,
    @Param('documentId') documentId: string,
    @Body() rawBody: string | undefined,
  ) {
    const request = this.usersService.parsePatchProgressRequest(rawBody);
    return this.usersService.patchProgress(userId, documentId, request);
  }

  @Get(':userId/documents/:documentId/progress')
  getProgress(
    @Param('userId') userId: string,
    @Param('documentId') documentId: string,
  ) {
    return this.usersService.getProgress(userId, documentId);
  }

  @Patch(':userId/mastery')
  patchMastery(
    @Param('userId') userId: string,
    @Body() rawBody: string | undefined,
  ) {
    const request = this.usersService.parsePatchMasteryRequest(rawBody);
    return this.usersService.patchMastery(userId, request);
  }

  @Get(':userId/mastery')
  listMastery(
    @Param('userId') userId: string,
    @Query('scopeType') scopeType?: string,
    @Query('scopeId') scopeId?: string,
  ) {
    return this.usersService.listMastery(userId, scopeType, scopeId);
  }

  @Post(':userId/quiz-attempts')
  createQuizAttempt(
    @Param('userId') userId: string,
    @Body() rawBody: string | undefined,
  ) {
    const request = this.usersService.parseCreateQuizAttemptRequest(rawBody);
    return this.usersService.createQuizAttempt(userId, request);
  }

  @Get(':userId/quiz-attempts')
  listQuizAttempts(
    @Param('userId') userId: string,
    @Query('documentId') documentId?: string,
    @Query('chapterId') chapterId?: string,
  ) {
    return this.usersService.listQuizAttempts(userId, documentId, chapterId);
  }

  @Post(':userId/annotations')
  upsertAnnotation(
    @Param('userId') userId: string,
    @Body() rawBody: string | undefined,
  ) {
    const request = this.usersService.parseUpsertAnnotationRequest(rawBody);
    return this.usersService.upsertAnnotation(userId, request);
  }

  @Get(':userId/annotations')
  listAnnotations(
    @Param('userId') userId: string,
    @Query('documentId') documentId?: string,
    @Query('targetType') targetType?: string,
    @Query('kind') kind?: string,
  ) {
    return this.usersService.listAnnotations(userId, { documentId, targetType, kind });
  }
}
