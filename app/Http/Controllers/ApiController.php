<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

abstract class ApiController extends Controller
{
    /** Validate explicit fields, rejecting unknown top-level input. */
    protected function input(Request $request, array $rules): array
    {
        $allowed = array_unique(array_map(fn ($key) => explode('.', $key)[0], array_keys($rules)));
        $unknown = array_diff(array_keys($request->except('_token')), $allowed);
        if ($unknown) {
            throw ValidationException::withMessages(array_fill_keys($unknown, ['This field is not accepted.']));
        }

        return $request->validate($rules);
    }

    protected function userData($user): ?array
    {
        return StakingData::user($user);
    }
}
