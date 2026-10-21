<?php

namespace Database\Seeders;

use App\Models\CopyStrategy;
use Illuminate\Database\Seeder;

/** Default strategy definitions only: no users, fixtures, stakes or wallet funds. */
class CopyStrategySeeder extends Seeder
{
    public function run(): void
    {
        foreach ([
            ['touchline', 'Touchline Method', 'football', 'balanced', 2, 'Selective football match-winner picks published by the platform administrator. Each new pick allocates 2% of available strategy funds.'],
            ['court', 'Court Vision', 'basketball', 'measured', 2, 'A basketball strategy using administrator-published picks. Each new pick allocates 2% of available strategy funds.'],
            ['mixed', 'Mixed Playbook', 'all', 'dynamic', 3, 'Administrator-published picks across sports. Each new pick allocates 3% of available strategy funds. Returns depend on actual settled game results.'],
        ] as [$slug, $name, $sport, $risk, $percentage, $description]) {
            CopyStrategy::firstOrCreate(['slug' => $slug], ['name' => $name, 'sport' => $sport, 'risk' => $risk, 'stake_percentage' => $percentage, 'description' => $description, 'active' => true]);
        }
    }
}
