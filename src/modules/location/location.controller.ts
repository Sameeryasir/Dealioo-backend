import { Body, Controller, Delete, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Location } from '../../db/entities/location.entity';
import { CreateLocationDto } from './locationDto/create-location.dto';
import { LocationService } from './location.service';
import { UpdateLocationDto } from './locationDto/update-location.dto';

@Controller('location')
export class LocationController {
    constructor(private readonly locationService: LocationService) {}

    @UseGuards(AuthGuard('jwt'))
    @Post('create')
    async createLocation(@Body() createLocationDto: CreateLocationDto, @Req() req): Promise<Location> {
        const user = req.user;
        return this.locationService.createLocation(createLocationDto, user);
    }
    @UseGuards(AuthGuard('jwt'))
    @Put(':id')
    async updateLocation(@Param('id') id: number, @Body() updateLocationDto: UpdateLocationDto, @Req() req): Promise<Location> {
        const user = req.user;
        return this.locationService.updateLocation(id, updateLocationDto, user);
    }
    @UseGuards(AuthGuard('jwt'))
    @Delete(':id')
    async deleteLocation(@Param('id') id: number, @Req() req): Promise<Location> {
        const user = req.user;
        return this.locationService.deleteLocation(id, user);
    }
    
}
