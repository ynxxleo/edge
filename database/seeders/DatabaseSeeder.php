<?php

namespace Database\Seeders;

use App\Models\SportEvent;
use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    public function run(): void
    {
        // Fictional sample fixtures. Rerunning the seeder never changes administrator edits or results.
        $fixtures = [
            ['football', 'EDGE Sample League', 'Harbor City', 'North Athletic', '1.8500', '3.6000', '4.2000'],
            ['football', 'EDGE Sample League', 'Metro United', 'Royal Sporting', '2.1500', '3.4000', '3.1000'],
            ['football', 'EDGE Sample Cup', 'Coastal FC', 'Summit Rovers', '2.4000', '3.5000', '2.8000'],
            ['basketball', 'EDGE Sample Basketball', 'Lagos Hoopers', 'Capital Celtics', '2.1000', null, '1.7500'],
            ['tennis', 'EDGE Sample Tennis', 'Alex Rivera', 'Jordan Ellis', '1.7000', null, '2.2500'],
            ['cricket', 'EDGE Sample Cricket', 'Coastal XI', 'Mountain XI', '1.8000', null, '2.0500'],
            ['esports', 'EDGE Sample Esports', 'Team Neon', 'Black Circuit', '1.6500', null, '2.3000'],
        ];
        foreach ($fixtures as $index => [$sport, $league, $home, $away, $homeOdds, $drawOdds, $awayOdds]) {
            SportEvent::firstOrCreate(['league' => $league, 'home_name' => $home, 'away_name' => $away], [
                'sport' => $sport, 'country' => 'Sample fixtures', 'starts_at' => now()->addDays(2)->startOfHour()->addHours($index),
                'status' => 'open', 'odds_home' => $homeOdds, 'odds_draw' => $drawOdds, 'odds_away' => $awayOdds,
            ]);
        }
        $this->call(CopyStrategySeeder::class);
    }
}
