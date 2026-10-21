<?php

namespace App\Http\Controllers;

use App\Models\User;
use App\Services\KycRequirementsService;
use App\Services\KycService;
use App\Services\StakingRules;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class KycRequirementsController extends ApiController
{
    public function settings(Request $request, KycRequirementsService $service): JsonResponse
    {
        StakingRules::admin($request->user());
        $this->input($request, []);

        return $this->json(['settings' => $service->settingsData()]);
    }

    public function updateSettings(Request $request, KycRequirementsService $service): JsonResponse
    {
        StakingRules::admin($request->user());
        $service->updateSettings($request->user(), $request->except('_token'));

        return $this->json(['settings' => $service->settingsData()]);
    }

    public function users(Request $request, KycRequirementsService $service, KycService $kyc): JsonResponse
    {
        StakingRules::admin($request->user());
        $input = $this->input($request, [
            'search' => ['sometimes', 'nullable', 'string', 'max:150'],
            'page' => ['sometimes', 'integer', 'min:1'],
        ]);
        $search = trim($input['search'] ?? '');
        $users = User::query()->when($search !== '', fn ($query) => $query->where(function ($query) use ($search): void {
            // Literal substring search: percent/underscore do not expand to every account.
            $needle = '%'.str_replace(['!', '%', '_'], ['!!', '!%', '!_'], $search).'%';
            $query->whereRaw("name LIKE ? ESCAPE '!'", [$needle])->orWhereRaw("email LIKE ? ESCAPE '!'", [$needle]);
            if (ctype_digit($search)) {
                $query->orWhere('id', (int) $search);
            }
        }))->orderBy('id')->paginate(20);

        return $this->json([
            'users' => $users->getCollection()->map(function (User $user) use ($service, $kyc): array {
                $requirements = $service->forUser($user);

                return [...$this->identity($user), 'kyc_status' => $kyc->summary($user)['status'],
                    'requirements_version' => $requirements['version'], 'layer_ids' => $requirements['layer_ids'], 'reason' => $requirements['reason']];
            })->all(),
            'pagination' => ['current_page' => $users->currentPage(), 'last_page' => $users->lastPage(), 'total' => $users->total(), 'per_page' => $users->perPage()],
        ]);
    }

    public function showUser(Request $request, User $user, KycRequirementsService $service): JsonResponse
    {
        StakingRules::admin($request->user());
        $this->input($request, []);

        return $this->json(['user' => $this->identity($user), 'requirements' => $service->forUser($user)]);
    }

    public function updateUser(Request $request, User $user, KycRequirementsService $service): JsonResponse
    {
        StakingRules::admin($request->user());
        $service->updateUser($user, $request->user(), $request->except('_token'));

        return $this->json(['user' => $this->identity($user), 'requirements' => $service->forUser($user)]);
    }

    private function identity(User $user): array
    {
        return ['id' => $user->id, 'name' => $user->name, 'email' => $user->email];
    }

    private function json(array $data): JsonResponse
    {
        return response()->json($data)->header('Cache-Control', 'private, no-store, max-age=0')->header('Pragma', 'no-cache')->header('X-Content-Type-Options', 'nosniff');
    }
}
